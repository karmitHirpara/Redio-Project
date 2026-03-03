const { execSync } = require('child_process');

const ports = [3001, 5173, 5174, 5175];

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function safeRun(cmd) {
  try {
    return run(cmd);
  } catch (_err) {
    return '';
  }
}

function findPidsOnPort(port) {
  const out = safeRun(`netstat -ano | findstr :${port}`);
  if (!out.trim()) return [];

  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // netstat format (example):
    // TCP    127.0.0.1:3001   0.0.0.0:0   LISTENING   12345
    const parts = trimmed.split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }

  return [...pids];
}

function killPid(pid) {
  // /T kills child processes too; /F forces termination.
  safeRun(`taskkill /PID ${pid} /T /F`);
}

let killedAny = false;
for (const port of ports) {
  const pids = findPidsOnPort(port);
  if (pids.length === 0) continue;

  for (const pid of pids) {
    killPid(pid);
    killedAny = true;
  }
}

if (killedAny) {
  // Give Windows a moment to release sockets.
  safeRun('powershell -NoProfile -Command "Start-Sleep -Milliseconds 300"');
}
