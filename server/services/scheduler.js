import { query, run, get } from '../config/database.js';
import crypto from 'crypto';
import { validateTrack } from './preFlightScan.js';

// Helper to emit the latest queue over WebSocket, mirroring queue.js behaviour
async function emitQueueUpdated(app) {
  const broadcastEvent = app.get('broadcastEvent');
  if (typeof broadcastEvent !== 'function') return;

  try {
    const queueItems = await query(`
      SELECT q.*, t.name, t.artist, t.duration, t.size, t.file_path
      FROM queue q
      JOIN tracks t ON q.track_id = t.id
      ORDER BY q.order_position
    `);

    const formatted = queueItems.map((item) => ({
      id: item.id,
      track: {
        id: item.track_id,
        name: item.name,
        artist: item.artist,
        duration: item.duration,
        size: item.size,
        filePath: item.file_path,
      },
      fromPlaylist: item.from_playlist,
      order: item.order_position,
    }));

    // Tag scheduler-driven updates so the frontend can treat them as
    // explicit preemptions even when the same track ID appears at the
    // front of the queue.
    broadcastEvent({ type: 'queue-updated', queue: formatted, reason: 'schedule-preempt' });
  } catch (error) {
    console.error('Failed to emit queue-updated event from scheduler', error);
  }
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
  // Start a transaction so we can safely check status and enqueue
  await run('BEGIN TRANSACTION');

  try {
    const schedule = await get('SELECT * FROM schedules WHERE id = ?', [scheduleId]);

    if (!schedule || schedule.status !== 'pending' || schedule.type !== 'datetime') {
      await run('ROLLBACK');
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

    if (!tracks || tracks.length === 0) {
      // Nothing to enqueue; just mark as completed
      const nowIso = new Date().toISOString();
      await run(
        `UPDATE schedules
         SET status = 'completed', updated_at = ?, fired_at = ?, completed_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, nowIso, scheduleId],
      );
      await run('COMMIT');
      return true;
    }

    // MISSION-CRITICAL: Pre-validate tracks before adding to queue
    const validTracks = [];
    for (const track of tracks) {
      const validation = await validateTrack(track.id);
      if (validation.ok) {
        validTracks.push(track);
      } else {
        console.error(`[Scheduler] Skipping invalid track "${track.name}" (${track.id}): ${validation.error}`);
        // Log to broadcast so UI can show warning if needed
        const broadcastEvent = app.get('broadcastEvent');
        if (typeof broadcastEvent === 'function') {
          broadcastEvent({
            type: 'schedule-track-skipped',
            scheduleId,
            trackId: track.id,
            trackName: track.name,
            error: validation.error
          });
        }
      }
    }

    if (validTracks.length === 0) {
      console.warn(`[Scheduler] Schedule ${scheduleId} results in 0 valid tracks. Completing without enqueuing.`);
      const nowIso = new Date().toISOString();
      await run(
        `UPDATE schedules
         SET status = 'completed', updated_at = ?, fired_at = ?, completed_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, nowIso, scheduleId],
      );
      await run('COMMIT');
      return true;
    }

    // If requested, lock the playlist right as it starts.
    if (schedule.lock_playlist) {
      await run('UPDATE playlists SET locked = 1 WHERE id = ?', [schedule.playlist_id]);
    }

    // Prepend scheduled tracks to the top of the queue while preserving
    // everything that was already queued.
    // Shift the existing queue block down by N positions.
    await run('UPDATE queue SET order_position = order_position + ?', [validTracks.length]);

    // Insert scheduled tracks at positions 0..N-1
    let cursor = 0;
    for (const track of validTracks) {
      const queueId = crypto.randomUUID();
      await run(
        `INSERT INTO queue (id, track_id, from_playlist, order_position)
         VALUES (?, ?, ?, ?)`,
        [queueId, track.id, null, cursor],
      );
      cursor += 1;
    }

    const nowIso = new Date().toISOString();
    await run(
      `UPDATE schedules
       SET status = 'completed', updated_at = ?, fired_at = ?, completed_at = ?
       WHERE id = ?`,
      [nowIso, nowIso, nowIso, scheduleId],
    );

    await run('COMMIT');

    // Emit queue update after commit
    await emitQueueUpdated(app);

    if (schedule.lock_playlist) {
      emitPlaylistLocked(app, schedule.playlist_id, true);
    }
    return true;
  } catch (error) {
    console.error('Failed to fire schedule atomically', error);
    try {
      await run('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed after scheduler error', rollbackError);
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
