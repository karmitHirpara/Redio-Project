// audio-worker.js - Dedicated background worker for Audio Engine timing and fetching

let fetchQueue = [];
let isFetching = false;
let crossfadeTimer = null;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'PREFETCH_TRACK':
      fetchQueue.push(payload.url);
      processFetchQueue();
      break;

    case 'START_TIMER':
      if (crossfadeTimer !== null) clearInterval(crossfadeTimer);
      crossfadeTimer = setInterval(() => {
        self.postMessage({ type: 'TIMER_TICK', timestamp: Date.now() });
      }, 50); // 50ms high-res heartbeat immune to React UI freezes
      break;

    case 'STOP_TIMER':
      if (crossfadeTimer !== null) clearInterval(crossfadeTimer);
      crossfadeTimer = null;
      break;
      
    case 'CLEAR_QUEUE':
      fetchQueue = [];
      break;
  }
};

async function processFetchQueue() {
  if (isFetching || fetchQueue.length === 0) return;
  isFetching = true;

  const url = fetchQueue.shift();
  try {
    // We fetch the entire ArrayBuffer in the background worker to prevent
    // main thread I/O blocking. We then transfer it via Transferable Objects.
    const req = await fetch(url);
    if (req.ok) {
      const buffer = await req.arrayBuffer();
      self.postMessage(
        { type: 'TRACK_BUFFER_LOADED', url, buffer },
        [buffer] // Transfer ownership to main thread for zero-copy decodeAudioData
      );
    } else {
      self.postMessage({ type: 'TRACK_FETCH_ERROR', url, error: 'HTTP ' + req.status });
    }
  } catch (err) {
    self.postMessage({ type: 'TRACK_FETCH_ERROR', url, error: err.message });
  } finally {
    isFetching = false;
    processFetchQueue();
  }
}
