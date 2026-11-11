import fs from 'node:fs';
import { spawn } from 'node:child_process';

let lastLaunchTime = 0;

function launchDetached(cmd, args = []) {
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Automatically launches the Liquid Glass Dynamic Island HUD as a clean,
 * frameless desktop application window (via Chrome/Edge --app mode).
 * Zero browser tabs, zero address bar, behaves like a native desktop widget.
 */
export function launchDesktopOverlay(port = 4040) {
  if (
    process.env.CI === 'true' ||
    process.env.UDROP_NO_GUI === '1' ||
    process.env.UDROP_NATIVE_OVERLAY === '1'
  ) {
    return false;
  }

  const now = Date.now();
  // Debounce: prevent multiple windows spawning within 10 seconds
  if (now - lastLaunchTime < 10000) {
    return false;
  }
  lastLaunchTime = now;

  const url = `http://localhost:${port}/island`;
  const appArgs = [`--app=${url}`, '--window-size=540,150', '--window-position=500,20'];

  if (process.platform === 'win32') {
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];

    for (const p of chromePaths) {
      if (fs.existsSync(p)) {
        return launchDetached(p, appArgs);
      }
    }

    for (const p of edgePaths) {
      if (fs.existsSync(p)) {
        return launchDetached(p, appArgs);
      }
    }

    return launchDetached('cmd.exe', ['/c', 'start', '""', url]);
  } else if (process.platform === 'darwin') {
    return launchDetached('open', ['-na', 'Google Chrome', '--args', `--app=${url}`]) ||
      launchDetached('open', [url]);
  } else {
    return launchDetached('google-chrome', [`--app=${url}`]) ||
      launchDetached('xdg-open', [url]);
  }
}
