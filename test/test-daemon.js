import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  installAutoStart,
  uninstallAutoStart
} from '../src/daemon.js';

console.log('=== RUNNING UDROP BACKGROUND DAEMON & SERVICE TEST SUITE ===\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

const TEST_PORT = 4955;

async function runDaemonTests() {
  try {
    // 1. Initial State: Must be null
    await stopDaemon(); // Ensure clean slate
    const initialStatus = await getDaemonStatus();
    assert(initialStatus === null, 'getDaemonStatus returns null when daemon is not running');

    // 2. Start Daemon headlessly
    console.log(`  Starting background daemon on port ${TEST_PORT}...`);
    const startRes = await startDaemon({ port: TEST_PORT });
    assert(startRes.success === true, 'startDaemon resolves with success: true');
    assert(typeof startRes.pid === 'number' && startRes.pid > 0, `startDaemon returns valid PID (${startRes.pid})`);
    assert(startRes.port === TEST_PORT, `startDaemon records target port ${TEST_PORT}`);

    // 3. Status Check
    const activeStatus = await getDaemonStatus();
    assert(activeStatus !== null, 'getDaemonStatus reports ACTIVE when daemon is running');
    assert(activeStatus.pid === startRes.pid, 'Status PID matches spawned child PID');
    assert(activeStatus.hostInfo && typeof activeStatus.hostInfo.hostname === 'string', 'Status includes live hostInfo ping');

    // 4. HTTP API verification
    const pingRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/info`);
    assert(pingRes.status === 200, 'Background daemon actively answers HTTP requests on target port');
    const pingData = await pingRes.json();
    assert(pingData.port === TEST_PORT, 'API info matches configured daemon port');

    // 5. Idempotent Start: Calling startDaemon while already active
    const secondStart = await startDaemon({ port: TEST_PORT });
    assert(secondStart.alreadyRunning === true, 'startDaemon detects already running daemon');
    assert(secondStart.pid === startRes.pid, 'Second start preserves existing daemon PID');

    // 6. Stop Daemon
    console.log('  Stopping background daemon...');
    const stopRes = await stopDaemon();
    assert(stopRes.success === true, 'stopDaemon cleanly shuts down the process');
    assert(stopRes.stoppedPid === startRes.pid, 'stopDaemon terminates the correct PID');

    // 7. Verify Process & State Cleanup
    const afterStopStatus = await getDaemonStatus();
    assert(afterStopStatus === null, 'getDaemonStatus returns null after daemon shutdown');

    // 8. Auto-Start Registry Installation (Windows)
    if (process.platform === 'win32') {
      console.log('  Testing Windows auto-start logon registration...');
      const installRes = await installAutoStart({ port: 4040 });
      assert(installRes.success === true, 'installAutoStart successfully configures Windows logon entry');

      // Verify VBS launcher was generated
      const vbsPath = path.join(os.homedir(), '.udrop', 'launcher.vbs');
      assert(fs.existsSync(vbsPath), 'Silent VBScript launcher generated in ~/.udrop/');

      // Uninstall Auto-Start
      const uninstallRes = await uninstallAutoStart();
      assert(uninstallRes.success === true, 'uninstallAutoStart cleanly removes registry key');
      assert(!fs.existsSync(vbsPath), 'VBScript launcher removed after uninstall');
    }

  } catch (err) {
    console.error('Fatal test exception:', err);
    failed++;
  } finally {
    // Final safety cleanup
    await stopDaemon();
    if (process.platform === 'win32') {
      await uninstallAutoStart();
    }
  }

  console.log(`\nResults: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runDaemonTests().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
