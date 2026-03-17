import { query, run, get } from '../config/database.js';
import logger from './logger.js';
// import { validateTrack } from './preFlightScan.js';

import { enqueueTrackCopy, emitQueueUpdated as emitQueueUpdatedRoute } from '../routes/queue.js';

async function emitQueueUpdated(app) {
  await emitQueueUpdatedRoute(app);
}

function emitPlaylistLocked(app, playlistId, locked) {
  const broadcastEvent = app.get('broadcastEvent');
  if (typeof broadcastEvent !== 'function') return;
  broadcastEvent({ type: 'playlist-locked', playlistId, locked: Boolean(locked) });
}

// Atomically fire a single datetime schedule by ID.
// - Appends its playlist tracks to the queue (skipping invalid ones)
// - Marks the schedule as completed
// - Emits queue-updated over WebSocket
export async function fireScheduleAtomically(scheduleId, app) {
  try {
    // 1. Mark as 'firing' immediately to prevent duplicate triggers from tick
    await run("UPDATE schedules SET status = 'firing', updated_at = ? WHERE id = ? AND status = 'pending'", [new Date().toISOString(), scheduleId]);

    const schedule = await get("SELECT * FROM schedules WHERE id = ? AND status = 'firing'", [scheduleId]);

    if (!schedule || schedule.type !== 'datetime') {
      return false;
    }

    // Load playlist tracks in order
    const tracks = await query(
      `SELECT t.*
       FROM playlist_tracks pt
       JOIN tracks t ON pt.track_id = t.id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position`,
      [schedule.playlist_id],
    );

    logger.debug(`[Scheduler] Found ${tracks?.length || 0} tracks for playlist`);

    if (!tracks || tracks.length === 0) {
      // Nothing to enqueue; just delete the empty schedule
      await run(
        `DELETE FROM schedules WHERE id = ?`,
        [scheduleId],
      );
      return true;
    }

    // BROADCAST PRE-FIRE EVENT
    // This allows the frontend to pause current playback, log history, and create a 2s gap.
    const broadcastEvent = app.get('broadcastEvent');
    if (typeof broadcastEvent === 'function') {
      logger.info(`[Scheduler] Broadcasting schedule-pre-fire for schedule ${scheduleId}`);
      broadcastEvent({
        type: 'schedule-pre-fire',
        scheduleId,
        playlistId: schedule.playlist_id
      });

      // Wait for 2.5 seconds (2s gap + buffer) before enqueuing and starting playback.
      // This ensures the frontend has time to process the transition.
      await new Promise(resolve => setTimeout(resolve, 2500));
    }

    // Start a transaction so we can safely check status and enqueue
    await run('BEGIN TRANSACTION');

    // Re-verify status hasn't changed during sleep
    const latest = await get("SELECT status FROM schedules WHERE id = ? AND status = 'firing'", [scheduleId]);
    if (!latest) {
      await run('ROLLBACK');
      return false;
    }

    // If requested, lock the playlist right as it starts.
    if (schedule.lock_playlist) {
      await run('UPDATE playlists SET locked = 1 WHERE id = ?', [schedule.playlist_id]);
    }

    // Prepend scheduled tracks to the top of the queue while preserving
    // everything that was already queued.
    // With isolated queue storage, we rebuild the queue order by inserting
    // new items at the top, then shifting existing items down.

    // Load current queue ids (from queue DB via route helper)
    const queueDb = await import('../config/queueDatabase.js');

    // Perform queue operations in a separate transaction on the queue database
    await queueDb.run('BEGIN TRANSACTION');
    try {
      const existingQueue = await queueDb.query('SELECT id FROM queue_items ORDER BY order_position');
      console.log(`[Scheduler] Shifting ${existingQueue.length} existing queue items by ${tracks.length}`);
      for (let i = 0; i < existingQueue.length; i += 1) {
        await queueDb.run('UPDATE queue_items SET order_position = ? WHERE id = ?', [i + tracks.length, existingQueue[i].id]);
      }

      let cursor = 0;
      for (const track of tracks) {
        console.log(`[Scheduler] Enqueuing scheduled track "${track.name}" (${track.id}) at position ${cursor}`);
        try {
          // We call enqueueTrackCopy which normally handles its own DB logic.
          // Since we are inside a queueDb transaction here, we need to ensure 
          // enqueueTrackCopy doesn't conflict. 
          await enqueueTrackCopy({ trackId: String(track.id), fromPlaylist: null, orderPosition: cursor });
          cursor += 1;
        } catch (enqueueErr) {
          logger.error(`[Scheduler] Failed to enqueue track "${track.name}": ${enqueueErr.message}`);
        }
      }
      await queueDb.run('COMMIT');
    } catch (queueErr) {
      console.error('[Scheduler] Queue transaction failed', queueErr);
      await queueDb.run('ROLLBACK');
      throw queueErr;
    }

    // Delete the datetime schedule after it fires so the playlist is "clear" for the next schedule.
    await run(
      `DELETE FROM schedules WHERE id = ?`,
      [scheduleId],
    );

    await run('COMMIT');

    console.log(`[Scheduler] Deleted fired schedule ${scheduleId}. Broadcasting updates.`);

    // 1. Emit queue update after commit
    await emitQueueUpdated(app);

    // 2. Emit direct schedule-deleted event for immediate UI response
    const broadcastEventFinal = app.get('broadcastEvent');
    if (typeof broadcastEventFinal === 'function') {
      console.log(`[Scheduler] Broadcasting schedule-deleted for ${scheduleId}`);
      broadcastEventFinal({
        type: 'schedule-deleted',
        scheduleId,
        playlistId: schedule.playlist_id
      });
      // 3. Also emit the broader playlistsUpdated for general sync
      broadcastEventFinal({ type: 'playlistsUpdated' });
    }

    if (schedule.lock_playlist) {
      emitPlaylistLocked(app, schedule.playlist_id, true);
    }
    return true;
  } catch (error) {
    logger.error(`[Scheduler] Firing FAILED for schedule ${scheduleId}:`, error);
    try {
      // Check if a transaction is actually active before trying to rollback
      // to avoid "no transaction is active" error.
      await run('ROLLBACK');
    } catch {
      // ignore
    }
    return false;
  }
}

// Periodic tick: find due datetime schedules and fire them one by one
export async function runSchedulerTick(app) {
  const nowIso = new Date().toISOString();

  try {
    if (process.env.SCHEDULER_DEBUG === '1') {
      try {
        const next = await get(
          `SELECT id, date_time
           FROM schedules
           WHERE type = 'datetime'
             AND status = 'pending'
             AND date_time IS NOT NULL
           ORDER BY date_time ASC
           LIMIT 1`,
        );
        console.log('[scheduler]', { nowIso, next: next ? { id: next.id, date_time: next.date_time } : null });
      } catch {
        // ignore
      }
    }

    const due = await query(
      `SELECT id
       FROM schedules
       WHERE type = 'datetime'
         AND status = 'pending'
         AND date_time IS NOT NULL
         AND date_time <= ?`,
      [nowIso],
    );

    if (!due || due.length === 0) return;

    for (const row of due) {
      if (process.env.SCHEDULER_DEBUG === '1') {
        console.log('[scheduler] firing', row.id);
      }
      await fireScheduleAtomically(row.id, app);
    }
  } catch (error) {
    console.error('Scheduler tick failed', error);
  }
}
