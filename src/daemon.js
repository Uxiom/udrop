import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, exec } from 'node:child_process';
import util from 'node:util';
import { getLocalIpAddresses, getLocalHostInfo } from './network.js';

const execAsync = util.promisify(exec);

const UDROP_DIR = path.join(os.homedir(), '.udrop');
const DAEMON_FILE = path.join(UDROP_DIR, 'daemon.json');
const LAUNCHER_VBS = path.join(UDROP_DIR, 'launcher.vbs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Pings local HTTP server to verify daemon health.
 */
function pingServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/info`, { timeout: 1500 }, (res) => {
      if (res.statusCode === 200) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ alive: true, data });
          } catch (e) {
            resolve({ alive: false });
          }
        });
      } else {
        resolve({ alive: false });
      }
    });
    req.on('error', () => resolve({ alive: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ alive: false });
    });
  });
}

/**
 * Checks if the uDrop background daemon is actively running.
 */
export async function getDaemonStatus() {
  if (!fs.existsSync(DAEMON_FILE)) return null;

  try {
    const raw = fs.readFileSync(DAEMON_FILE, 'utf-8');
    const state = JSON.parse(raw);

    // Check if process ID is still alive
    let processAlive = false;
    try {
      process.kill(state.pid, 0);
      processAlive = true;
    } catch (e) {
      processAlive = false;
    }

    if (!processAlive) {
      fs.rmSync(DAEMON_FILE, { force: true });
      return null;
    }

    // Ping HTTP endpoint
    const ping = await pingServer(state.port);
    if (!ping.alive) {
      fs.rmSync(DAEMON_FILE, { force: true });
      return null;
    }

    return {
      ...state,
      hostInfo: ping.data
    };
  } catch (err) {
    return null;
  }
}

/**
 * Starts the uDrop server as a completely detached background process.
 */
export async function startDaemon({ port = 4040, binPath } = {}) {
  const existing = await getDaemonStatus();
  if (existing) {
    return { alreadyRunning: true, ...existing };
  }

  ensureDir(UDROP_DIR);

  const _dir = typeof __dirname !== 'undefined' ? __dirname : (typeof import.meta !== 'undefined' && import.meta.dirname ? import.meta.dirname : path.dirname(process.argv[1]));
  const resolvedBin = binPath || path.resolve(_dir, '../bin/index.js');
  const nodeExec = process.execPath;

  const logFile = path.join(UDROP_DIR, 'daemon.log');
  const out = fs.openSync(logFile, 'a');

  // Spawn completely detached from terminal with hidden window
  const child = spawn(nodeExec, [resolvedBin, '--port', String(port), '--daemon-child'], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: process.env
  });

  child.unref();
  const childPid = child.pid;

  // Wait for server to bind & listen
  const startTime = Date.now();
  let bound = false;
  while (Date.now() - startTime < 3500) {
    await new Promise(r => setTimeout(r, 200));
    const ping = await pingServer(port);
    if (ping.alive) {
      bound = true;
      break;
    }
  }

  if (!bound) {
    try { process.kill(childPid); } catch (e) {}
    throw new Error(`Failed to confirm background daemon startup on port ${port}.`);
  }

  const hostInfo = getLocalHostInfo(port);
  const connectUrl = hostInfo.mdnsUrl;

  const state = {
    pid: childPid,
    port: Number(port),
    connectUrl,
    startedAt: Date.now()
  };

  fs.writeFileSync(DAEMON_FILE, JSON.stringify(state, null, 2));

  return {
    success: true,
    ...state
  };
}

/**
 * Stops the running background daemon.
 */
export async function stopDaemon() {
  const state = await getDaemonStatus();
  if (!state) {
    return { running: false };
  }

  try {
    process.kill(state.pid, 'SIGINT');
  } catch (e) {
    // Fallback on Windows
    try {
      await execAsync(`taskkill /F /PID ${state.pid}`);
    } catch (err) {}
  }

  // Wait up to 2s for exit
  let stopped = false;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 150));
    try {
      process.kill(state.pid, 0);
    } catch (e) {
      stopped = true;
      break;
    }
  }

  fs.rmSync(DAEMON_FILE, { force: true });
  return { success: true, stoppedPid: state.pid };
}

/**
 * Registers uDrop for automatic background startup when user logs into Windows.
 * Runs silently in user-space without any UAC elevation prompts.
 */
export async function installAutoStart({ port = 4040, binPath } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('Auto-start registration is currently implemented for Windows.');
  }

  ensureDir(UDROP_DIR);

  const _dir = typeof __dirname !== 'undefined' ? __dirname : (typeof import.meta !== 'undefined' && import.meta.dirname ? import.meta.dirname : path.dirname(process.argv[1]));
  const resolvedBin = binPath || path.resolve(_dir, '../bin/index.js');
  const nodeExec = process.execPath;

  // Create silent VBScript launcher (prevents black CMD window from briefly flashing at logon)
  const vbsContent = [
    'Set WshShell = CreateObject("WScript.Shell")',
    'WshShell.Run """" & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """ --port " & WScript.Arguments(2) & " --daemon-child", 0, False',
    ''
  ].join('\r\n');

  fs.writeFileSync(LAUNCHER_VBS, vbsContent, 'utf-8');

  // Command executed by Windows on logon
  const runCommand = `wscript.exe //B "${LAUNCHER_VBS}" "${nodeExec}" "${resolvedBin}" "${port}"`;

  // Register in Current User Run registry
  const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "uDrop" /t REG_SZ /d "${runCommand.replace(/"/g, '\\"')}" /f`;
  await execAsync(regCmd);

  return {
    success: true,
    runCommand
  };
}

/**
 * Uninstalls uDrop from Windows startup.
 */
export async function uninstallAutoStart() {
  if (process.platform !== 'win32') return { success: false };

  try {
    await execAsync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "uDrop" /f');
  } catch (err) {
    // Key might not exist
  }

  if (fs.existsSync(LAUNCHER_VBS)) {
    fs.rmSync(LAUNCHER_VBS, { force: true });
  }

  return { success: true };
}
