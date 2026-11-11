import { execSync } from 'node:child_process';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

async function testStandaloneExe() {
  console.log('=== TESTING NATIVE STANDALONE EXECUTABLE (udrop.exe) ===\n');

  // 1. Launch udrop.exe --silent
  console.log('1. Launching dist/udrop.exe --silent...');
  execSync('.\\dist\\udrop.exe --silent', { stdio: 'ignore' });

  // Wait 1.5 seconds for background socket binding
  await new Promise(r => setTimeout(r, 1500));

  // 2. Query /api/info
  console.log('2. Querying http://localhost:4040/api/info...');
  const infoRes = await fetch('http://localhost:4040/api/info');
  assert(infoRes.status === 200, 'Info route responds with 200');
  const info = await infoRes.json();
  console.log('   [PASS] Hostname:', info.hostname, '| Port:', info.port);

  // 3. Test Monochromatic QR Finishes
  console.log('3. Testing Optical Card finishes...');
  const [obsidian, titanium, paper] = await Promise.all([
    fetch('http://localhost:4040/api/qr.svg?theme=obsidian').then(r => r.text()),
    fetch('http://localhost:4040/api/qr.svg?theme=titanium').then(r => r.text()),
    fetch('http://localhost:4040/api/qr.svg?theme=paper').then(r => r.text())
  ]);

  assert(obsidian.includes('#09090B') && obsidian.includes('#FAFAFA'), 'Obsidian finish ok');
  assert(titanium.includes('#27272A') && titanium.includes('#FAFAFA'), 'Titanium finish ok');
  assert(paper.includes('fill="#FAFAFA"') && paper.includes('fill="#09090B"'), 'Paper finish ok');

  console.log('   [PASS] Obsidian Finish  (#09090B / #FAFAFA)');
  console.log('   [PASS] Titanium Finish  (#27272A / #FAFAFA)');
  console.log('   [PASS] Inverted White   (#FAFAFA / #09090B)');

  // 4. Test PWA Frontend Serving & Dynamic Island Removal
  console.log('4. Testing PWA Frontend on root route...');
  const html = await fetch('http://localhost:4040/').then(r => r.text());
  assert(!html.includes('id="dynamicIsland"'), 'Dynamic Island must be removed');
  assert(html.includes('class="app-header"'), 'Sleek header present');
  console.log('   [PASS] Dynamic Island removed from body: true');
  console.log('   [PASS] Sleek header present: true');

  // 5. Test Live Chunked P2P File Upload (Simulating phone upload)
  console.log('5. Testing Live Chunked P2P File Upload...');
  const testData = crypto.randomBytes(512 * 1024); // 512 KB
  const testHash = crypto.createHash('sha256').update(testData).digest('hex');
  const fileId = 'test_upload_' + Date.now();
  const fileName = 'standalone-verified-' + Date.now() + '.bin';

  // Init upload
  const initRes = await fetch('http://localhost:4040/api/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId,
      fileName,
      fileSize: testData.length,
      fileType: 'application/octet-stream',
      chunkSize: 256 * 1024,
      totalChunks: 2
    })
  });
  assert(initRes.status === 200, 'Upload init responds 200');

  // Send chunks
  const chunk0 = testData.subarray(0, 256 * 1024);
  const chunk1 = testData.subarray(256 * 1024);

  const c0Res = await fetch(`http://localhost:4040/api/upload/chunk/${fileId}/0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: chunk0
  });
  assert(c0Res.status === 200, 'Chunk 0 accepted');

  const c1Res = await fetch(`http://localhost:4040/api/upload/chunk/${fileId}/1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: chunk1
  });
  assert(c1Res.status === 200, 'Chunk 1 accepted');

  // Complete
  const compRes = await fetch(`http://localhost:4040/api/upload/complete/${fileId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromSlot: 'X', toSlot: 'U' })
  });
  assert(compRes.status === 200, 'Upload complete responds 200');
  const compData = await compRes.json();
  console.log('   [PASS] File assembled on host disk:', compData.result.filePath);

  // Verify bit-for-bit integrity on disk
  const savedBuf = fs.readFileSync(compData.result.filePath);
  const savedHash = crypto.createHash('sha256').update(savedBuf).digest('hex');
  assert(savedHash === testHash, 'Saved file SHA-256 hash must bit-for-bit match');
  console.log('   [PASS] Bit-for-bit integrity verified (SHA-256 matches)');

  // Clean up uploaded test file
  fs.rmSync(compData.result.filePath, { force: true });

  // 6. Test System Overlay QR Matrix & Loopback Outbound Registration
  console.log('6. Testing Native QR Matrix & Loopback Outbound Registration...');
  const qrMatrixRes = await fetch('http://127.0.0.1:4040/api/qr.matrix');
  assert(qrMatrixRes.status === 200, 'GET /api/qr.matrix returns 200');
  const qrMatrix = await qrMatrixRes.json();
  assert(qrMatrix.size > 15 && Array.isArray(qrMatrix.rows) && qrMatrix.rows.length === qrMatrix.size, 'QR matrix rows match module dimensions');
  assert(typeof qrMatrix.mdnsUrl === 'string' && typeof qrMatrix.ipUrl === 'string', 'QR matrix includes both mDNS and LAN IP URLs');
  console.log('   [PASS] QR Matrix verified (' + qrMatrix.size + 'x' + qrMatrix.size + ' modules)');

  const tempSharePath = path.join(process.cwd(), 'test', 'tmp-explorer-share.txt');
  fs.writeFileSync(tempSharePath, 'Explorer share payload');
  try {
    const shareRes = await fetch('http://127.0.0.1:4040/api/outbound/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tempSharePath })
    });
    assert(shareRes.status === 200, 'POST /api/outbound/register returns 200 on loopback');
    const shareData = await shareRes.json();
    assert(shareData.success === true && shareData.file.name === 'tmp-explorer-share.txt', 'Outbound file registered cleanly');
    const dlShare = await fetch(`http://127.0.0.1:4040/api/download/${shareData.file.id}`);
    assert(dlShare.status === 200 && (await dlShare.text()) === 'Explorer share payload', 'Explorer-shared file is downloadable immediately');

    const kineticRes = await fetch('http://127.0.0.1:4040/qr-kinetic.js');
    assert(kineticRes.status === 200 && (await kineticRes.text()).includes('createKineticQr'), 'Embedded bundle serves /qr-kinetic.js cleanly');

    const overlayStateRes = await fetch('http://127.0.0.1:4040/api/overlay/state');
    assert(overlayStateRes.status === 200, 'GET /api/overlay/state returns 200 on loopback');
    const overlayState = await overlayStateRes.json();
    assert(overlayState.outboundFiles.some(f => f.id === shareData.file.id), 'Live overlay state exposes registered outbound file');

    const unshareRes = await fetch(`http://127.0.0.1:4040/api/outbound/${shareData.file.id}`, { method: 'DELETE' });
    assert(unshareRes.status === 200 && (await unshareRes.json()).success === true, 'DELETE /api/outbound/:id unshares file');
    const afterUnshare = await (await fetch('http://127.0.0.1:4040/api/overlay/state')).json();
    assert(!afterUnshare.outboundFiles.some(f => f.id === shareData.file.id), 'Unshared file removed from overlay state');

    console.log('   [PASS] Loopback Explorer sharing, overlay state, and unshare pipeline verified');
  } finally {
    fs.rmSync(tempSharePath, { force: true });
  }

  // 7. Test Safe Stop (--stop) without terminating test runner node.exe
  console.log('7. Testing udrop.exe --stop clean shutdown (PID-safe)...');
  execSync('.\\dist\\udrop.exe --stop', { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 400));
  let offline = false;
  try {
    await fetch('http://127.0.0.1:4040/api/info');
  } catch (e) {
    offline = true;
  }
  assert(offline === true, 'Port 4040 cleanly closed after udrop.exe --stop');
  console.log('   [PASS] Engine stopped cleanly without affecting other Node processes');

  // 8. Test udrop.exe & standalone udrop-setup.exe binaries
  console.log('8. Testing udrop.exe Tray Controller & Standalone udrop-setup.exe binaries...');
  const exeBuf = fs.readFileSync(path.join(process.cwd(), 'dist', 'udrop.exe'));
  assert(exeBuf[0] === 0x4D && exeBuf[1] === 0x5A, 'udrop.exe has valid MZ Win32 PE header');
  assert(exeBuf.includes('GlassQrOverlayForm') && exeBuf.includes('TrayFlyoutForm') && exeBuf.includes('DoubleBufferedPanel'), 'udrop.exe contains Tray Flyout and double-buffered Kinetic Glass Overlay');
  assert(exeBuf.includes('asInvoker'), 'udrop.exe contains antivirus-safe asInvoker manifest');

  const setupPath = path.join(process.cwd(), 'dist', 'udrop-setup.exe');
  assert(fs.existsSync(setupPath), 'dist/udrop-setup.exe must exist');
  assert(fs.existsSync(path.join(process.cwd(), 'installer', 'uninstall.bat')), 'installer/uninstall.bat source exists');
  const setupBuf = fs.readFileSync(setupPath);
  assert(setupBuf[0] === 0x4D && setupBuf[1] === 0x5A, 'udrop-setup.exe has valid MZ Win32 PE header');
  assert(setupBuf.includes('UDropInstaller'), 'Contains setup wizard metadata');
  assert(setupBuf.includes('uDropPayload.zip'), 'Contains self-contained embedded uDropPayload.zip resource');
  assert(setupBuf.includes(Buffer.from('Uninstall\\uDrop', 'utf16le')), 'Registers per-user Uninstall registry key in HKCU');
  assert(setupBuf.includes('asInvoker'), 'Contains antivirus-safe asInvoker manifest');
  console.log('   [PASS] udrop.exe and standalone udrop-setup.exe verified (Win32 PE, asInvoker, Embedded Payload OK)');

  console.log('\n=== ALL STANDALONE EXECUTABLE & LIVE TRANSFER TESTS PASSED (100% OK) ===');
}

testStandaloneExe().catch(err => {
  console.error('\n[FAIL] Test encountered error:', err.message);
  process.exit(1);
});
