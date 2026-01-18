// electron/preload.cjs
'use strict';

// Security: do not expose any Electron/Node APIs into the renderer.
// The renderer communicates with the local backend via HTTP/WebSocket.
