<p align="left">
  <a href="https://github.com/Uxiom">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/uxiom-light.svg">
      <source media="(prefers-color-scheme: light)" srcset="docs/uxiom-dark.svg">
      <img alt="Uxiom" src="docs/uxiom-dark.svg" height="24">
    </picture>
  </a>
</p>

# uDrop — Zero-Router Cross-Platform P2P File Transfer

[![npm version](https://img.shields.io/npm/v/@uxiom/udrop.svg)](https://www.npmjs.com/package/@uxiom/udrop)
[![license](https://img.shields.io/npm/l/@uxiom/udrop.svg)](LICENSE)
![100% Offline](https://img.shields.io/badge/offline-100%25-brightgreen)
![Zero App Install](https://img.shields.io/badge/phone%20app-none%20required-blue)
![UXIOM Mesh Mode](https://img.shields.io/badge/UXIOM-Ring%20Mesh%205--Node-yellow)

`uDrop` is a fast, 100% offline, cross-platform file transfer engine connecting **Windows, iPhone (Safari), Android (Chrome), macOS, and Linux** over direct local Wi-Fi — with **no cloud upload, no account login, and no mobile app installation required**.

---

## Download & Use (End Users)

### Windows 10 / 11 (No Terminal or Node.js Needed)
1. Download **[uDrop-Setup.exe](https://github.com/Uxiom/udrop/releases/latest/download/uDrop-Setup.exe)** (or **[uDrop-Portable-win64.zip](https://github.com/Uxiom/udrop/releases/latest/download/uDrop-Portable-win64.zip)**) from **[GitHub Releases](https://github.com/Uxiom/udrop/releases/latest)**.
2. Run `uDrop-Setup.exe` (user-space `asInvoker`, zero admin UAC required, cleanly uninstallable from Windows Installed Apps or `%LOCALAPPDATA%\uDrop\uninstall.bat`).
3. Click the **`[ U ]`** icon beside your taskbar clock/Wi-Fi icon — or press **`Ctrl + Shift + U`** — to flip uDrop **ON** (**OFF by default** at boot).
4. **Kinetic QR -> Live Transfer Overlay**: Turning uDrop **ON** assembles particles into a frosted-glass QR code right on screen. Scan it with iPhone/Android Camera; once paired, the QR pieces smoothly dismantle and morph into the **Live Transfer Overlay Dashboard** showing real-time transfer speeds, `[Open]` buttons for received files, and drag-and-drop Host-to-Phone sharing (with instant `[X]` unshare).
5. **Explorer Right-Click Share**: Right-click any file in Windows Explorer -> **Share via uDrop**.

### macOS / Linux / Cross-Platform CLI
```bash
# Run immediately without permanent installation
npx @uxiom/udrop

# Or install globally
npm install -g @uxiom/udrop
```

Common CLI commands:
```bash
udrop ./video.mp4 ./archive.zip    # Share files immediately from terminal
udrop --hotspot                    # Direct Windows Wi-Fi hotspot (router-less)
udrop service start                # Start background daemon
udrop service status               # Show active port & URLs
udrop service stop                 # Stop background daemon cleanly
```

For full controls, hotkeys, and troubleshooting, read **[docs/](https://uxiom.github.io/udrop/)**, **[SYSTEM_FEATURE_GUIDE.md](SYSTEM_FEATURE_GUIDE.md)**, and **[MANUAL.md](MANUAL.md)**.

---

## Key Capabilities

- **Kinetic Pairing QR -> Live Overlay Dashboard**: Particles assemble into the pairing QR (`Use IP` / `Use .local`), then dismantle into a live floating transfer monitor upon scan.
- **UXIOM 5-Node Ring Mesh (`U - X - I - O - M`)**: PC anchors `[ U ]`; up to 4 phones/devices claim `[ X ]`, `[ I ]`, `[ O ]`, `[ M ]` with automatic stale-node pruning, iPhone-to-Android bridging, and `[ ALL ]` Swarm broadcasts.
- **Adaptive Bandwidth Engine**: Dedicated single-stream XHR (`concurrency: 1`) for single files up to 64 MB, dual resumable chunk pipelines for batches, direct sparse `w+` SSD offset writes (`writeChunk`), mobile screen wake-lock, and instant queue/handle purge on cancel.
- **Loopback Security Isolation**: Host-only controls (`/api/outbound/register`, `/api/outbound/:id`, `/api/open-folder`, `/api/open-file`, `/api/qr/popup`, `/api/shutdown`) reject non-loopback sockets (`403 Forbidden`).

---

## For Open-Source Developers (`@uxiom/udrop` API)

uDrop exports clean ESM modules so you can embed its local P2P transfer engine, ring mesh state, direct-offset storage, or vector QR generator inside your own GPL-3.0 projects.

```bash
npm install @uxiom/udrop
```

### Package Exports
- `@uxiom/udrop` -> HTTP + SSE server (`startServer`)
- `@uxiom/udrop/transfer` -> Direct-offset upload sessions & outbound registry (`initUploadSession`, `writeChunk`, `finalizeUpload`, `cancelUploadSession`, `closeAllSessions`, `registerOutboundFile`, `unregisterOutboundFile`, `getOutboundFiles`, `getDownloadDirectory`)
- `@uxiom/udrop/mesh` -> 5-node ring coordination & SSE broadcast (`registerMeshNode`, `unregisterMeshNode`, `pruneStaleNodes`, `getMeshRing`, `dispatchMeshTransfer`, `broadcastHostTransferEvent`)
- `@uxiom/udrop/network` -> LAN IPv4 & mDNS resolution (`getLocalIpAddresses`, `getLocalHostInfo`)
- `@uxiom/udrop/qr` -> High-contrast vector QR generator (`generateSleekQrSvg`)
- `@uxiom/udrop/daemon` -> Background daemon helpers (`startDaemon`, `stopDaemon`, `getDaemonStatus`, `installAutoStart`, `uninstallAutoStart`)

### Example Usage
```js
import { startServer } from '@uxiom/udrop';
import { registerOutboundFile, getDownloadDirectory } from '@uxiom/udrop/transfer';
import { getLocalHostInfo } from '@uxiom/udrop/network';

const server = await startServer({
  port: 4040,
  onUploadComplete: (result) => {
    console.log('Saved:', result.filePath);
  },
  onShutdown: () => {
    console.log('Engine stopped');
  }
});

registerOutboundFile('./sample.zip');
console.log('Download dir:', getDownloadDirectory());
console.log('Connect URLs:', getLocalHostInfo(4040));
```

---

## Building & Testing from Source

```bash
git clone https://github.com/Uxiom/udrop.git
cd udrop
npm install

# Run cross-platform core, mesh, HTTP, and daemon test suite (Linux / macOS / Windows)
npm test

# Windows-only: bundle assets, compile udrop.exe + udrop-setup.exe + portable ZIP
npm run build:win

# Windows-only: verify native executables and live EXE pipeline
npm run test:win
```

---

## Support & License

- **Creator & Maintainer**: [@vd1686](https://github.com/vd1686) ([Uxiom](https://github.com/Uxiom))
- **Email Support & Commercial Licensing**: [uxiom.support@gmail.com](mailto:uxiom.support@gmail.com)
- **GitHub Issues**: [https://github.com/Uxiom/udrop/issues](https://github.com/Uxiom/udrop/issues)
- **Open-Source License**: **GNU General Public License v3.0 (`GPL-3.0-only`)** — see [LICENSE](LICENSE) (`Copyright (c) 2026 Uxiom`). Distributed derivatives or applications incorporating uDrop code must also be licensed under GPL v3.0.
- **Commercial / Closed-Source Exception**: Organizations wishing to embed uDrop or parts of uDrop inside proprietary or closed-source commercial software without releasing source under GPL v3.0 can inquire about a separate commercial license at **[uxiom.support@gmail.com](mailto:uxiom.support@gmail.com)**.
