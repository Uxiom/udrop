import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startServer } from '../src/server.js';
import {
  registerOutboundFile,
  getDownloadDirectory,
  initUploadSession,
  writeChunk,
  cancelUploadSession
} from '../src/transfer.js';
import { pruneStaleNodes, unregisterMeshNode } from '../src/mesh.js';

console.log('=== RUNNING UDROP CORE & UXIOM MESH VERIFICATION SUITE ===\n');

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

const TEST_PORT = 4999;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runTests() {
  const server = await startServer({ port: TEST_PORT });

  try {
    // -------------------------------------------------------------
    // Test 1: Health check / info
    // -------------------------------------------------------------
    const infoRes = await fetch(`${BASE_URL}/api/info`);
    assert(infoRes.status === 200, 'GET /api/info returns 200 OK');
    const infoData = await infoRes.json();
    assert(typeof infoData.hostname === 'string', 'Info reports valid host machine name');

    // -------------------------------------------------------------
    // Test 2: Serves PWA index.html & Sleek Custom QR Endpoints
    // -------------------------------------------------------------
    const htmlRes = await fetch(`${BASE_URL}/`);
    assert(htmlRes.status === 200, 'Serves PWA frontend on root route');
    const htmlText = await htmlRes.text();
    assert(htmlText.includes('uDrop'), 'PWA HTML contains uDrop branding');
    assert(htmlText.includes('UXIOM Ring Topology'), 'PWA HTML contains UXIOM Ring Mesh component');

    const qrSvgRes = await fetch(`${BASE_URL}/api/qr.svg?theme=orange`);
    assert(qrSvgRes.status === 200, 'GET /api/qr.svg serves custom vector SVG card');
    const qrSvgText = await qrSvgRes.text();
    assert(qrSvgText.includes('<svg') && qrSvgText.includes('UXIOM MESH'), 'QR SVG contains custom squircle modules and Uxiom branding');

    const qrPageRes = await fetch(`${BASE_URL}/qr`);
    assert(qrPageRes.status === 200, 'GET /qr serves sleek QR showcase card viewer');

    // -------------------------------------------------------------
    // Test 3: Outbound file registration & download
    // -------------------------------------------------------------
    const dummyFile = path.join(os.tmpdir(), 'udrop-test-outbound.txt');
    fs.writeFileSync(dummyFile, 'Hello from uDrop PC Outbound Stream!');
    const outbound = registerOutboundFile(dummyFile);
    assert(outbound.name === 'udrop-test-outbound.txt', 'Successfully registers outbound file');

    const downloadRes = await fetch(`${BASE_URL}/api/download/${outbound.id}`);
    assert(downloadRes.status === 200, 'GET /api/download/:id streams file back to client');
    const downloadedText = await downloadRes.text();
    assert(downloadedText === 'Hello from uDrop PC Outbound Stream!', 'Streamed content matches original source file');

    // -------------------------------------------------------------
    // Test 4: Chunked upload & auto-assembly
    // -------------------------------------------------------------
    const fileId = 'test_sample_transfer_123';
    const chunkSize = 10;
    const chunk0 = Buffer.from('1234567890');
    const chunk1 = Buffer.from('abcdefghij');
    const chunk2 = Buffer.from('ABCDEFGHIJ');
    const fullExpected = '1234567890abcdefghijABCDEFGHIJ';

    // 4a. Init session
    const initRes = await fetch(`${BASE_URL}/api/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        fileName: 'assembled-test.txt',
        fileSize: fullExpected.length,
        totalChunks: 3,
        chunkSize
      })
    });
    assert(initRes.status === 200, 'POST /api/upload/init initiates upload session');

    // 4b. Send chunks
    const c0Res = await fetch(`${BASE_URL}/api/upload/chunk/${fileId}/0`, { method: 'PUT', body: chunk0 });
    const c1Res = await fetch(`${BASE_URL}/api/upload/chunk/${fileId}/1`, { method: 'PUT', body: chunk1 });
    const c2Res = await fetch(`${BASE_URL}/api/upload/chunk/${fileId}/2`, { method: 'PUT', body: chunk2 });
    assert(c0Res.ok && c1Res.ok && c2Res.ok, 'PUT /api/upload/chunk accepts binary chunk slices');

    // 4c. Verify status
    const statusRes = await fetch(`${BASE_URL}/api/upload/status/${fileId}`);
    const statusData = await statusRes.json();
    assert(statusData.receivedChunks.length === 3, 'GET /api/upload/status tracks received chunks for auto-resume');

    // 4d. Finalize & stitch
    const completeRes = await fetch(`${BASE_URL}/api/upload/complete/${fileId}`, { method: 'POST' });
    assert(completeRes.status === 200, 'POST /api/upload/complete stitches chunks into final file');
    const completeData = await completeRes.json();

    const assembledPath = completeData.result.filePath;
    assert(fs.existsSync(assembledPath), 'Assembled file saved to disk in target uDrop folder');
    const assembledContent = fs.readFileSync(assembledPath, 'utf-8');
    assert(assembledContent === fullExpected, 'Assembled file content perfectly matches binary chunks');

    // Clean up
    fs.rmSync(dummyFile, { force: true });
    fs.rmSync(assembledPath, { force: true });

    // -------------------------------------------------------------
    // Test 4c: Cancel In-Progress Transfer & Clean Partial Disk Files
    // -------------------------------------------------------------
    const downloadDir = getDownloadDirectory();
    const cancelFileId = 'cancel_test_' + Date.now();
    await fetch(`${BASE_URL}/api/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: cancelFileId,
        fileName: 'partial-to-cancel.dat',
        fileSize: 1024 * 1024,
        totalChunks: 4,
        chunkSize: 256 * 1024
      })
    });
    // Send 1 chunk
    await fetch(`${BASE_URL}/api/upload/chunk/${cancelFileId}/0`, {
      method: 'PUT',
      body: Buffer.alloc(256 * 1024, 'A')
    });
    // Cancel transfer
    const cancelRes = await fetch(`${BASE_URL}/api/upload/cancel/${cancelFileId}`, { method: 'POST' });
    assert(cancelRes.status === 200, 'POST /api/upload/cancel/:id responds 200 OK');
    const cancelData = await cancelRes.json();
    assert(cancelData.success === true && cancelData.cancelled === true, 'Cancellation reported success');

    // Partial file must be deleted from disk
    const partialPath = path.join(downloadDir, 'partial-to-cancel.dat');
    assert(!fs.existsSync(partialPath), 'Partial file was immediately cleaned from disk on cancellation');

    // -------------------------------------------------------------
    // Test 5: UXIOM Ring Topology & Mesh Nodes
    // -------------------------------------------------------------
    const ringRes = await fetch(`${BASE_URL}/api/mesh/ring`);
    assert(ringRes.status === 200, 'GET /api/mesh/ring returns 200 OK');
    const ringData = await ringRes.json();
    assert(Array.isArray(ringData.ring) && ringData.ring.length === 5, 'Ring topology exposes exactly 5 slots [U, X, I, O, M]');
    assert(ringData.ring[0].slot === 'U' && ringData.ring[0].isHost === true, 'Slot [ U ] is reserved and assigned to Host Master');

    // -------------------------------------------------------------
    // Test 6: Dynamic Node Registration (iPhone & Android)
    // -------------------------------------------------------------
    // 6a. Register iPhone (should take slot X)
    const joinIphoneRes = await fetch(`${BASE_URL}/api/mesh/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client_iphone_node_x',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
      })
    });
    const iphoneResult = await joinIphoneRes.json();
    assert(iphoneResult.slot === 'X', 'First mobile device is assigned slot [ X ]');
    assert(iphoneResult.node.platform === 'ios', 'Platform correctly identified as iOS');

    // 6b. Register Android (should take slot I)
    const joinAndroidRes = await fetch(`${BASE_URL}/api/mesh/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client_android_node_i',
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile'
      })
    });
    const androidResult = await joinAndroidRes.json();
    assert(androidResult.slot === 'I', 'Second mobile device is assigned slot [ I ]');
    assert(androidResult.node.platform === 'android', 'Platform correctly identified as Android');

    // -------------------------------------------------------------
    // Test 7: Mesh Heartbeat Keep-Alive
    // -------------------------------------------------------------
    const heartbeatRes = await fetch(`${BASE_URL}/api/mesh/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client_iphone_node_x' })
    });
    assert(heartbeatRes.status === 200, 'POST /api/mesh/heartbeat refreshes node lease');

    // -------------------------------------------------------------
    // Test 8: Inter-Node Transit Bridge (iPhone [X] ➔ Android [I])
    // -------------------------------------------------------------
    // Connect SSE listener to capture mesh events
    const ssePromise = new Promise((resolve, reject) => {
      const sseReq = http.request(`${BASE_URL}/api/mesh/events`, (res) => {
        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk.toString();
          if (buffer.includes('incoming_mesh_transfer')) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const event = JSON.parse(line.replace('data: ', ''));
                  if (event.type === 'incoming_mesh_transfer') {
                    res.destroy();
                    resolve(event);
                    return;
                  }
                } catch (e) {}
              }
            }
          }
        });
      });
      sseReq.on('error', reject);
      sseReq.end();
    });

    // iPhone [X] streams a 4K ProRes simulation chunk to Laptop Host [U]
    const meshFileId = 'mesh_4k_transfer_prores';
    const sample4KContent = 'SIMULATED_4K_PRORES_VIDEO_STREAM_DATA_PACKET_60FPS';
    await fetch(`${BASE_URL}/api/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: meshFileId,
        fileName: '4k_video.mov',
        fileSize: sample4KContent.length,
        totalChunks: 1,
        chunkSize: sample4KContent.length
      })
    });

    await fetch(`${BASE_URL}/api/upload/chunk/${meshFileId}/0`, {
      method: 'PUT',
      body: Buffer.from(sample4KContent)
    });

    // Complete upload with mesh target [ I ] (Android)
    const meshCompleteRes = await fetch(`${BASE_URL}/api/upload/complete/${meshFileId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromSlot: 'X',
        toSlot: 'I'
      })
    });
    assert(meshCompleteRes.status === 200, 'POST /api/upload/complete completes file with target mesh slot [ I ]');

    // Await SSE dispatch
    const sseEvent = await ssePromise;
    assert(sseEvent.type === 'incoming_mesh_transfer', 'SSE broadcasts incoming_mesh_transfer event to mesh');
    assert(sseEvent.transfer.fromSlot === 'X' && sseEvent.transfer.toSlot === 'I', 'Transfer metadata preserves source Node [ X ] and target Node [ I ]');
    assert(sseEvent.transfer.fileName === '4k_video.mov', 'Transfer metadata preserves original filename');

    // Android [I] downloads the bridged file via the outbound stream URL
    const meshDownloadRes = await fetch(`${BASE_URL}${sseEvent.transfer.downloadUrl}`);
    assert(meshDownloadRes.status === 200, 'Target Node [ I ] streams file directly from bridged local endpoint');
    const downloadedMeshContent = await meshDownloadRes.text();
    assert(downloadedMeshContent === sample4KContent, 'Target received bit-for-bit identical 4K video stream without quality loss');

    // Clean up mesh file
    const meshSavedPath = path.join(downloadDir, '4k_video.mov');
    if (fs.existsSync(meshSavedPath)) {
      fs.rmSync(meshSavedPath, { force: true });
    }

    // -------------------------------------------------------------
    // Test 6: Monochromatic Dashboard & Explorer Integration
    // -------------------------------------------------------------
    assert(!htmlText.includes('id="dynamicIsland"'), 'PWA index.html cleanly removes Dynamic Island overlay');
    assert(htmlText.includes('class="app-header"'), 'PWA index.html includes sleek monochromatic header');

    const islandPageRes = await fetch(`${BASE_URL}/island`);
    assert(islandPageRes.status === 200, 'GET /island serves standalone Dynamic Island HUD window');
    const islandHtml = await islandPageRes.text();
    assert(islandHtml.includes('dynamicIsland'), 'HUD page renders Dynamic Island component');

    const openFolderRes = await fetch(`${BASE_URL}/api/open-folder`, { method: 'POST' });
    assert(openFolderRes.status === 200, 'POST /api/open-folder triggers OS explorer launch');
    const openFolderData = await openFolderRes.json();
    assert(openFolderData.success === true && typeof openFolderData.path === 'string', 'open-folder reports download path');

    const openFileRes = await fetch(`${BASE_URL}/api/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'assembled-test.txt' })
    });
    assert(openFileRes.status === 200, 'POST /api/open-file selects received file in Explorer');
    const openFileData = await openFileRes.json();
    assert(openFileData.success === true, 'open-file reports target path');

    // -------------------------------------------------------------
    // Test 7: Liquid Glass Optical Pairing Overlay Modal
    // -------------------------------------------------------------
    assert(htmlText.includes('id="qrGlassModal"'), 'PWA index.html includes Liquid Glass Optical Pairing Modal');
    assert(htmlText.includes('glass-modal-overlay'), 'Modal uses glass-modal-overlay styles');

    const qrPopupRes = await fetch(`${BASE_URL}/api/qr/popup`, { method: 'POST' });
    assert(qrPopupRes.status === 200, 'POST /api/qr/popup broadcasts open_qr_modal event');
    const qrPopupData = await qrPopupRes.json();
    assert(qrPopupData.success === true, 'qr/popup reports success');

    // -------------------------------------------------------------
    // Test 8: Native Tray QR Matrix & Outbound Register Loopback API
    // -------------------------------------------------------------
    const qrMatrixRes = await fetch(`${BASE_URL}/api/qr.matrix?mode=ip`);
    assert(qrMatrixRes.status === 200, 'GET /api/qr.matrix returns 200 OK');
    const qrMatrixData = await qrMatrixRes.json();
    assert(qrMatrixData.size > 15 && qrMatrixData.rows.length === qrMatrixData.size, 'QR matrix exposes square binary rows');
    assert(qrMatrixData.connectUrl === qrMatrixData.ipUrl, 'mode=ip encodes LAN IPv4 connectUrl');

    const badRegRes = await fetch(`${BASE_URL}/api/outbound/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert(badRegRes.status === 400, 'POST /api/outbound/register rejects missing filePath with 400');

    let shutdownTriggered = false;
    const shutdownServer = await startServer({
      port: TEST_PORT + 1,
      onShutdown: () => { shutdownTriggered = true; }
    });
    try {
      const sdRes = await fetch(`http://127.0.0.1:${TEST_PORT + 1}/api/shutdown`, { method: 'POST' });
      assert(sdRes.status === 200, 'POST /api/shutdown returns 200 on loopback');
      const sdJson = await sdRes.json();
      assert(sdJson.shuttingDown === true && shutdownTriggered === true, 'Shutdown triggers clean lifecycle hook');
    } finally {
      if (typeof shutdownServer.closeAllConnections === 'function') shutdownServer.closeAllConnections();
      shutdownServer.close();
    }

    // -------------------------------------------------------------
    // Test 9: Security Boundaries, Kinetic QR, Overlay State & Mesh Recovery
    // -------------------------------------------------------------
    const badPathRes = await fetch(`${BASE_URL}/api/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: path.join(os.tmpdir(), 'outside-udrop.txt') })
    });
    assert(badPathRes.status === 403, 'POST /api/open-file rejects paths outside download root with 403');

    const kineticRes = await fetch(`${BASE_URL}/qr-kinetic.js`);
    assert(kineticRes.status === 200, 'GET /qr-kinetic.js returns 200 OK');
    const kineticJs = await kineticRes.text();
    assert(kineticJs.includes('createKineticQr') && !kineticJs.includes('.local:4040'), 'qr-kinetic.js exposes createKineticQr without hardcoded PC hostname');

    const manifestRes = await fetch(`${BASE_URL}/manifest.json`);
    assert(manifestRes.status === 200, 'GET /manifest.json returns 200 OK');
    const manifestJson = JSON.parse(await manifestRes.text());
    assert(manifestJson.name === 'uDrop - UXIOM Mesh', 'manifest.json parses as clean UTF-8 JSON without mojibake');

    const hostJoinRes = await fetch(`${BASE_URL}/api/mesh/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'host_dashboard_u', isHostDashboard: true })
    });
    const hostJoinData = await hostJoinRes.json();
    assert(hostJoinData.slot === 'U', 'Host dashboard on loopback binds slot [ U ] instead of consuming [ X ]');

    const tempSpecial = path.join(os.tmpdir(), 'report; final (1).txt');
    fs.writeFileSync(tempSpecial, 'special filename content');
    const specialOutbound = registerOutboundFile(tempSpecial);
    try {
      const overlayRes = await fetch(`${BASE_URL}/api/overlay/state`);
      assert(overlayRes.status === 200, 'GET /api/overlay/state returns 200 on loopback');
      const overlayState = await overlayRes.json();
      assert(
        Array.isArray(overlayState.ring) &&
        Array.isArray(overlayState.activeTransfers) &&
        Array.isArray(overlayState.recentCompleted) &&
        overlayState.outboundFiles.some(f => f.id === specialOutbound.id),
        'GET /api/overlay/state reports ring, activeTransfers, recentCompleted, and outboundFiles'
      );

      const dlSpecial = await fetch(`${BASE_URL}/api/download/${specialOutbound.id}`);
      const disp = dlSpecial.headers.get('content-disposition') || '';
      assert(dlSpecial.status === 200 && disp.includes('filename="report; final (1).txt"'), 'Download sets sanitized Content-Disposition header');

      const delRes = await fetch(`${BASE_URL}/api/outbound/${specialOutbound.id}`, { method: 'DELETE' });
      const delJson = await delRes.json();
      assert(delRes.status === 200 && delJson.success === true, 'DELETE /api/outbound/:id unregisters outbound file');

      const afterDelState = await (await fetch(`${BASE_URL}/api/overlay/state`)).json();
      assert(!afterDelState.outboundFiles.some(f => f.id === specialOutbound.id), 'Unshared outbound file disappears from overlay state');
    } finally {
      fs.rmSync(tempSpecial, { force: true });
    }

    const boundsId = 'bounds_check_file';
    await initUploadSession({
      fileId: boundsId,
      fileName: 'bounds-check.bin',
      fileSize: 64,
      totalChunks: 1,
      chunkSize: 64
    });
    let invalidChunkRejected = false;
    try {
      await writeChunk(boundsId, 5, Buffer.from('overflow'));
    } catch (e) {
      invalidChunkRejected = true;
    }
    assert(invalidChunkRejected, 'writeChunk rejects out-of-range chunk indices');
    await cancelUploadSession(boundsId);

    await fetch(`${BASE_URL}/api/mesh/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client_extra_o', userAgent: 'Android' })
    });
    await fetch(`${BASE_URL}/api/mesh/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client_extra_m', userAgent: 'iPhone' })
    });
    await new Promise(r => setTimeout(r, 30));
    const pruned = pruneStaleNodes(1);
    assert(pruned === true, 'pruneStaleNodes expires idle mobile slots');
    const recoveredJoin = await (await fetch(`${BASE_URL}/api/mesh/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client_recovered_phone', userAgent: 'iPhone' })
    })).json();
    assert(recoveredJoin.slot === 'X', 'New device cleanly reclaims freed slot [ X ] after stale node pruning');
    unregisterMeshNode('client_recovered_phone');

    assert(
      !fs.existsSync(path.join(process.cwd(), 'daemon_debug.log')) &&
      !fs.existsSync(path.join(process.cwd(), 'ARCHITECTURE_NOTES.md')) &&
      !fs.existsSync(path.join(process.cwd(), 'src', 'public', 'assets', 'sleek-qr.svg')) &&
      !fs.existsSync(path.join(process.cwd(), 'assets')),
      'Repository contains zero unused/leaked temporary or template artifacts'
    );

  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close();
  }

  console.log(`\nResults: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
