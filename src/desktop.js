import fs from 'node:fs';
import { exec } from 'node:child_process';

let lastLaunchTime = 0;

/**
 * Automatically launches the Liquid Glass Dynamic Island HUD as a clean,
 * frameless desktop application window (via Chrome/Edge --app mode).
 * Zero browser tabs, zero address bar, behaves like a native desktop widget.
 */
export function launchDesktopOverlay(port = 4040) {
  const now = Date.now();
  // Debounce: prevent multiple windows spawning within 10 seconds
  if (now - lastLaunchTime < 10000) {
    return false;
  }
  lastLaunchTime = now;

  const url = `http://localhost:${port}/island`;

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
        exec(`"${p}" --app="${url}" --window-size=540,150 --window-position=500,20`);
        return true;
      }
    }

    for (const p of edgePaths) {
      if (fs.existsSync(p)) {
        exec(`"${p}" --app="${url}" --window-size=540,150 --window-position=500,20`);
        return true;
      }
    }

    exec(`start ${url}`);
    return true;
  } else if (process.platform === 'darwin') {
    exec(`open -na "Google Chrome" --args --app="${url}" || open "${url}"`);
    return true;
  } else {
    exec(`google-chrome --app="${url}" || xdg-open "${url}"`);
    return true;
  }
}
