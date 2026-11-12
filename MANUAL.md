# uDrop User Manual and Troubleshooting Guide

Welcome to the official manual for **uDrop**, the zero-router, cross-platform peer-to-peer file transfer engine by Uxiom.

uDrop allows you to beam uncompressed 4K videos, full-resolution photos, documents, and large archives between **Windows, iPhone, Android, and Mac** at hardware Wi-Fi speeds without cloud servers, without account logins, and **without installing any apps on mobile devices**.

---

## 1. Quick Installation (Zero Terminal Setup)

uDrop is designed to run quietly in the background with one-click system tray ergonomics. You do not need to open a command prompt or configure a server to use it.

### Method A: Standalone Windows Installer (`uDrop-Setup.exe`)
1. Download **`uDrop-Setup.exe`** from **[GitHub Releases](https://github.com/Uxiom/udrop/releases/latest)**. It is a single self-contained installer packaging the portable runtime and tray controller.
2. Double-click **`udrop-setup.exe`**:
   - **Custom Install Directory**: Defaults to `%LOCALAPPDATA%\uDrop` with a **Browse...** button for any custom folder.
   - **Setup Options**: Toggle Windows System Tray Auto-Start (starts **OFF** by default), Explorer `"Share via uDrop"` right-click context menu, Desktop shortcut, Start Menu shortcut, and Launch After Setup.
3. Click **Install** to watch the step-by-step extraction log.
4. Click **Finish**. The uDrop tray toggle appears in your Windows notification area beside Wi-Fi and Bluetooth.

### Method B: Portable Standalone Executable (`uDrop-Portable-win64.zip`)
1. Extract `udrop.exe`, `node.exe`, `bundle.cjs`, and `uninstall.bat` to any folder or USB drive.
2. Double-click **`udrop.exe`** to activate uDrop and display the floating Liquid Glass Pairing QR Overlay, or run `udrop.exe --tray` to sit quietly in the tray until clicked.

### Method C: Developer CLI (Node.js)
If you prefer running from a terminal:
```bash
# Run immediately without installation
npx @uxiom/udrop

# Or install globally
npm install -g @uxiom/udrop
```

---

## 2. Daily Workflow

### System Tray Toggle & Liquid Glass QR Overlay
*(See [SYSTEM_FEATURE_GUIDE.md](SYSTEM_FEATURE_GUIDE.md) for the complete control, hotkey, and CLI switch reference.)*

1. Look for the **`[ U ]`** uDrop icon in your Windows Taskbar System Tray (notification area next to Wi-Fi and Bluetooth). It starts **OFF** at boot so zero background ports or streams stay open until needed.
2. Click the tray icon (or press **`Ctrl + Shift + U`**) and switch uDrop **ON**.
3. Particles assemble into a floating **Liquid Glass Kinetic QR Overlay** displaying a crisp QR code and local network URL (`http://<host>.local:4040` or LAN IP). Use **`Use IP` / `Use .local`** if your Android phone cannot resolve `.local` hostnames.
4. Open the native **Camera** app on your iPhone or Android, scan the QR code, and tap the link to open uDrop in Safari or Chrome—zero mobile apps or accounts required. Once scanned, the QR pieces dismantle and morph into the **Live Hub** overlay (`Live Transfer & Share`), showing live progress bars, context-aware actions (`View` / `Play` / `Import` + `Dir`), drag-and-drop host sharing, and a **`Show QR`** toggle if another phone joins later.
5. When finished, switch uDrop **OFF** (from the tray flyout, overlay **`Turn OFF`**, or **`Ctrl + Shift + U`**) to close port `4040` immediately.

### Sharing Files Directly from Windows File Explorer
1. Right-click any video, photo, or document in Windows File Explorer.
2. Choose **Share via uDrop**.
3. uDrop automatically switches **ON**, registers that file for download, and pops open the **Liquid Glass QR Overlay** so any connected phone can download it immediately.

### Sending Files from Phone to Windows (Bandwidth Smartness)
1. On your phone, tap **Select Videos / Photos** or **All Files**.
2. **Single File Mode** (for example a 40 MB video): uDrop automatically allocates 100% bandwidth to one continuous direct stream (`<= 64 MB` in one full-speed request with real-time XHR percentage and inactivity watchdog), avoiding chunk round-trip latency.
3. **Smart Adaptive Batching (`< 10 MB` Queued vs `>= 10 MB` Parallel)**: Multi-file items under `10 MB` stream sequentially through a single-bandwidth queue with zero chunk fragmentation; batches with files `10 MB` or larger automatically switch to concurrent parallel streams (`4 MB`/`8 MB` resumable chunks, live aggregate progress, retry resilience, and automatic mobile wake-lock).
4. Files are saved directly to your PC's `Downloads\uDrop` folder.

### Sending Files from Windows to Phone (Context-Aware Handoff)
1. Right-click any file in File Explorer -> **Share via uDrop**, or drag and drop files onto either the **Live Transfer Overlay** or the local web dashboard (`http://localhost:4040`). To remove a shared file, click **`[X]`** next to it on either surface.
2. On your phone, **Files from Host** identifies each item (`PHOTO`, `VIDEO`, `CONTACT`, `PDF`, `AUDIO`, `ARCHIVE`):
   - **Photos / Videos**: Tap **Save Photo** / **Save Video** to open your phone's native Share Sheet (*Save Image* / *Save Video* into **Photos**), or tap **Download** for **Files -> Downloads**.
   - **Contact Cards (`.vcf`)**: Tap **Add Contact** to trigger iOS/Android's native Contacts import screen directly.
   - **PDF / Audio**: Tap **Preview** / **Play** or **Download**.
3. On Windows, completed uploads land in `Downloads\uDrop` with context verbs (**View** for photos/PDFs, **Play** for video/audio, **Import** for `.vcf` contacts, and **Dir** to highlight in File Explorer).

---

## 3. OS Quirks, Permissions & Firewalls

### Windows 10 / 11
1. **SmartScreen Prompt**: Downloaded binaries are unsigned (`asInvoker`). If Windows warns on first run, click **More info -> Run anyway**.
2. **Firewall & Network Profile**: Ensure Wi-Fi is set to **Private** (`Settings -> Network & internet -> Properties`) and click **Allow access** when Windows Defender Firewall prompts for Node.js / TCP `4040`.

### Android & iPhone
1. **`.local` mDNS Resolution**: If an Android phone cannot reach `<pc-name>.local:4040`, click **`Use IP`** on the Liquid Glass QR Overlay to encode direct LAN IPv4 (`http://192.168.x.x:4040`).
2. **iOS Safari**: Accept the **Local Network** permission prompt; disable iCloud Private Relay if local addresses time out.
3. **Android Chrome**: Avoid switching apps/locking screen during huge batches; disable strict battery optimization for Chrome if uploads pause.

### macOS & Linux
- **macOS**: Allow Local Network access under **System Settings -> Privacy & Security -> Local Network** for your Terminal/Node runtime.
- **Linux**: Ensure `avahi-daemon` is active for `.local` hostnames and permit port `4040/tcp` (`sudo ufw allow 4040/tcp`).

### Guest / Public Wi-Fi (Client Isolation)
If hotel or campus Wi-Fi blocks device-to-device packets, use direct hotspot mode:
`udrop --hotspot`
Point your phone camera at the terminal Wi-Fi QR code to join directly over `192.168.137.1` without an external router.

---

## 4. Uninstallation

To cleanly remove uDrop:
1. Uninstall **uDrop** from **Windows Settings -> Apps -> Installed apps**, or double-click **`uninstall.bat`** inside your install folder (`%LOCALAPPDATA%\uDrop\uninstall.bat`).
2. This cleanly runs `udrop.exe --stop`, stops tray instances, removes the Windows startup, Explorer context menu, and Add/Remove Programs registry keys (`HKCU`), deletes Start Menu and Desktop shortcuts, and clears application files.

---

## 5. Support & Contact

If you run into issues or need help setting up uDrop:
- **Email Support & Commercial Licensing**: [uxiom.support@gmail.com](mailto:uxiom.support@gmail.com)
- **Issue Tracker**: [https://github.com/Uxiom/udrop/issues](https://github.com/Uxiom/udrop/issues)
- **License**: GNU GPL v3.0 ([LICENSE](LICENSE)) — commercial closed-source licenses available via [uxiom.support@gmail.com](mailto:uxiom.support@gmail.com).
