import { query, run, get } from '../config/database.js';
import crypto from 'crypto';

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

// Atomically fire a single datetime schedule by ID.
// - Appends its playlist tracks to the queue
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

    // Preempt the current queue head so that the scheduled playlist plays
    // immediately, and the interrupted track is removed rather than
    // resuming.
    const existingQueue = await query(
      'SELECT id FROM queue ORDER BY order_position',
    );

    // Remove the first item (current track) if there is one.
    let remainingIds = [];
    if (existingQueue.length > 0) {
      const head = existingQueue[0];
      await run('DELETE FROM queue WHERE id = ?', [head.id]);
      remainingIds = existingQueue.slice(1).map((row) => row.id);
    }

    // Insert scheduled tracks at the front
    let cursor = 0;
    for (const track of tracks) {
      const queueId = crypto.randomUUID();
      await run(
        `INSERT INTO queue (id, track_id, from_playlist, order_position)
         VALUES (?, ?, ?, ?)`,
        [queueId, track.id, null, cursor],
      );
      cursor += 1;
    }

    // Reindex remaining queue items to follow the scheduled block
    for (const id of remainingIds) {
      await run(
        'UPDATE queue SET order_position = ? WHERE id = ?',
        [cursor, id],
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
      await fireScheduleAtomically(row.id, app);
    }
  } catch (error) {
    console.error('Scheduler tick failed', error);
  }
}
