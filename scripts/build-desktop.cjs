'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function getNodeCmd() {
  return process.execPath || (process.platform === 'win32' ? 'node.exe' : 'node');
}

function getNpmCliPath() {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  return path.join(__dirname, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function getElectronBuilderCliPath() {
  return path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
}

function runOrExit(cmd, args, env) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    env,
    shell: false,
  });

  if (r.error) {
    process.stderr.write(String(r.error && r.error.message ? r.error.message : r.error) + '\n');
    process.exitCode = 1;
    process.exit();
  }

  if (typeof r.status === 'number' && r.status !== 0) {
    process.exitCode = r.status;
    process.exit();
  }
}


(function main() {
  const env = { ...process.env };
  const nodeCmd = getNodeCmd();
  const npmCliPath = getNpmCliPath();
  const electronBuilderCliPath = getElectronBuilderCliPath();

  if (npmCliPath && fs.existsSync(npmCliPath)) {
    runOrExit(nodeCmd, [npmCliPath, 'run', 'build:web'], env);
    runOrExit(nodeCmd, [npmCliPath, 'run', 'rebuild:electron'], env);
  } else {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    runOrExit(npmCmd, ['run', 'build:web'], env);
    runOrExit(npmCmd, ['run', 'rebuild:electron'], env);
  }

  runOrExit(nodeCmd, [electronBuilderCliPath], env);
})();
