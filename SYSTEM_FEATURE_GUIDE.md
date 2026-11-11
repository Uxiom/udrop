# uDrop Windows System Feature Guide

uDrop runs on Windows 10 and Windows 11 as a lightweight, user-space system tray toggle (`udrop.exe`) built to give one-click ON/OFF ergonomics comparable to Wi-Fi and Bluetooth controls. It requires **zero administrator (UAC) elevation** (`asInvoker`) and keeps network ports completely closed until you turn it on.

---

## Quick Controls Summary

| Control / Trigger | Action |
| :--- | :--- |
| **Tray Icon (`[U]`) — Left-Click** | Opens the **Quick Toggle Flyout** above the bottom-right taskbar clock |
| **Tray Icon (`[U]`) — Right-Click** | Opens quick context menu (`Turn uDrop ON/OFF`, `Show Glass Pairing QR`, `Copy Connect URL`, `Open Downloads Folder`, `Open Web Dashboard`, `Quit`) |
| **Keyboard Shortcut (`Ctrl + Shift + U`)** | Global toggle from anywhere in Windows: switches uDrop **ON** (and pops up the Glass Pairing QR Overlay) or **OFF** |
| **File Explorer Right-Click -> `Share via uDrop`** | Turns uDrop **ON** automatically (if off), exposes the selected file for download, and opens the Glass Pairing QR Overlay |
| **Desktop / Start Menu `uDrop` Shortcut** | Launches tray host if offline, switches uDrop **ON**, and displays the Glass Pairing QR Overlay |

---

## 1. Windows Taskbar System Tray & Power States

After installation via **`udrop-setup.exe`** (or launching `udrop.exe --tray`), uDrop places a monochromatic **`[ U ]`** icon in the Windows notification area next to your clock, Wi-Fi, and Bluetooth icons.

### Default Startup State: OFF
- At Windows logon, uDrop starts in **OFF** mode by default.
- The icon appears as a muted gray circle (`uDrop: OFF (Click to turn on)`).
- **Port `4040` is closed** and **no background `node.exe` engine is running** (~2 MB idle tray footprint).

### Active State: ON
- Clicking the master toggle switch (or pressing `Ctrl + Shift + U`) starts the bundled Node HTTP/SSE transfer engine cleanly in the background.
- The tray icon switches to bright white with a green active dot (`uDrop: ON (Port 4040)`).
- Clicking the master toggle **OFF** sends a graceful loopback shutdown (`POST /api/shutdown`), terminates only uDrop's tracked engine PID (`~/.udrop/engine.pid`), closes any open pairing overlay, and shuts port `4040`.

---

## 2. Quick Toggle Flyout (`TrayFlyoutForm`)

Left-clicking the **`[ U ]`** tray icon opens a compact frosted-glass control card right above the taskbar corner (`Esc` or clicking outside dismisses it):

- **Master Power Pill Switch**: Flips the uDrop engine **ON** or **OFF**.
- **Active Endpoint Readout**: Shows both your local hostname link (`http://<pc-name>.local:4040`) and direct LAN IPv4 address (`http://<ip>:4040`).
- **UXIOM Mesh Status**: Shows how many mobile devices (`[ X ]`, `[ I ]`, `[ O ]`, `[ M ]`) are currently paired.
- **Show Glass QR Overlay**: Re-opens the floating QR overlay card on your screen.
- **Copy URL**: Copies the active connect link to the Windows clipboard.
- **Folder**: Opens `C:\Users\<user>\Downloads\uDrop` in File Explorer.
- **Web UI**: Opens the full browser dashboard at `http://localhost:4040?pair=1`.
- **Quit uDrop**: Stops the engine cleanly and exits the system tray icon.

---

## 3. Floating Liquid Glass Kinetic QR -> Live Transfer Overlay (`GlassQrOverlayForm`)

Whenever uDrop is flipped **ON** (from the tray switch, `Ctrl + Shift + U`, Desktop shortcut, or Explorer **`Share via uDrop`**), a frosted acrylic-glass card fades onto the center of your screen with zero browser windows or console tabs.

### Overlay Lifecycle & Controls
- **Kinetic QR Assemble & Post-Scan Dismantle**: On turn-ON, particles swirl and assemble into a crisp high-contrast QR matrix. As soon as a mobile camera scans and loads uDrop, the QR modules dismantle outward and morph automatically into the **Live Transfer Overlay Dashboard**.
- **Live Hub Dashboard**: Once paired, the overlay shows active peer slots (`U X I O M`), live upload/download progress bars, recently completed files with context-aware **`View`** / **`Play`** / **`Import`** / **`Open`** + **`Dir`** actions, drag-and-drop / **`+ Share File`** host sharing, per-file **`[X]`** unshare controls, and **`Show QR`** / **`Live Hub`** header switching.
- **`Use IP` / `Use .local` Switch**: Toggles the QR code and displayed address between mDNS hostname (`http://<host>.local:4040`) and direct LAN IPv4 (`http://<ip>:4040`)—useful on routers or Android setups that do not resolve `.local` hostnames.
- **Minimize (`–` / `Esc`)**: Minimizes the floating overlay cleanly back into the taskbar tray while keeping uDrop **ON**.
- **`Copy URL` / `Downloads` / `Web UI` / `Turn OFF`**: Copy pairing link, open `Downloads\uDrop`, launch browser UI, or close port `4040`.
- **Draggable Header**: Drag anywhere along the top bar to reposition the overlay.

---

## 4. Windows File Explorer Right-Click Sharing

When **"Add 'Share via uDrop' to Windows Explorer right-click menu"** is checked during installation:

1. Right-click any video, photo, ZIP archive, or document in Windows File Explorer.
2. Click **Share via uDrop**.
3. Windows invokes `"udrop.exe" --share "<file-path>"`.
4. uDrop automatically switches **ON** (if currently off), registers that file via loopback HTTP (`POST /api/outbound/register`), refreshes connected phones over Server-Sent Events, and opens the **Liquid Glass QR Overlay** showing `Ready to beam: <filename>` so any phone can scan and download immediately.

---

## 5. `udrop.exe` Command-Line Reference

| Flag | Behavior |
| :--- | :--- |
| `udrop.exe --tray` | Starts the persistent single-instance Windows System Tray host in **OFF** state (default Windows startup command) |
| `udrop.exe --tray --on` | Starts the System Tray host **ON** and immediately shows the Glass QR Overlay |
| `udrop.exe --toggle` | Sends an IPC signal to flip the running tray ON <-> OFF (starts tray ON if not yet running) |
| `udrop.exe --qr` | Ensures uDrop is **ON** and opens the Glass QR Overlay |
| `udrop.exe --share "<file>"` | Ensures uDrop is **ON**, registers `<file>` outbound, and opens the Glass QR Overlay |
| `udrop.exe --silent` | Starts the background transfer engine headlessly without opening a tray UI (useful for scripts/CI) |
| `udrop.exe --stop` | Sends graceful `POST /api/shutdown` and stops only uDrop's managed `engine.pid` |
| *(no arguments)* | Activates uDrop **ON** via the single-instance tray host and opens the Glass QR Overlay |

---

## 6. Installation, Security Model, and Uninstallation

### Downloading Public Releases
- **1-Click Installer (`uDrop-Setup.exe`)**: Single self-contained Windows executable (~32.7 MB) with embedded compressed runtime (`uDropPayload.zip`). Download from **GitHub Releases**, double-click, choose your install directory (default `%LOCALAPPDATA%\uDrop`), and click **Install**.
- **Portable Archive (`uDrop-Portable-win64.zip`)**: Extract anywhere and run `udrop.exe` or `udrop.exe --tray` with zero registry edits.

### Security & Privacy Boundaries
- **User-Space Only (`asInvoker`)**: No Windows UAC administrator prompts and no kernel drivers.
- **Registry Footprint (`HKCU` only)**:
  - Startup entry: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\uDrop`
  - Explorer right-click menu: `HKCU\Software\Classes\*\shell\uDropShare`
  - Uninstaller registration: `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\uDrop`
- **Loopback Guarded Host Controls**: `/api/outbound/register`, `/api/outbound/:id` (`DELETE`), `/api/open-folder`, `/api/open-file`, `/api/qr/popup`, and `/api/shutdown` strictly reject non-loopback sockets (`403 Forbidden`) so external LAN devices cannot read host paths, unshare files, launch local dialogs, or trigger server shutdown.
- **PID-Safe Termination**: `udrop.exe --stop` only closes the PID tracked in `%USERPROFILE%\.udrop\engine.pid`, never interrupting unrelated `node.exe` developer processes.

### Complete Removal
Uninstall from **Windows Settings -> Apps -> Installed apps -> uDrop**, or run **`%LOCALAPPDATA%\uDrop\uninstall.bat`** (supports `/S` silent mode):
1. Calls `udrop.exe --stop` and closes `udrop.exe`.
2. Removes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\uDrop`, `HKCU\Software\Classes\*\shell\uDropShare`, and `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\uDrop`.
3. Deletes Desktop/Start Menu shortcuts and application binaries (received files in `Downloads\uDrop` are preserved).

---

## 7. Building & Releasing from Source

Build the Windows tray controller (`dist/udrop.exe`), self-contained installer (`dist/udrop-setup.exe`), and portable ZIP (`dist/uDrop-Portable-win64.zip`) locally on Windows using:

```powershell
.\installer\build-windows.ps1 -CreatePortableZip
```

Run the cross-platform test suite (`npm test`) and native Windows binary verification (`npm run test:win`):

```powershell
npm test
npm run test:win
```

Push a version tag (`v*`) to publish assets automatically via [release.yml](.github/workflows/release.yml):

```powershell
git tag v1.0.0
git push origin v1.0.0
```

---

## 8. Support & Contact

For support, bug reports, or commercial closed-source licensing inquiries:
- **Email**: [uxiom.support@gmail.com](mailto:uxiom.support@gmail.com)
- **GitHub Issues**: [https://github.com/Uxiom/udrop/issues](https://github.com/Uxiom/udrop/issues)
- **License**: GNU GPL v3.0 ([LICENSE](LICENSE)) — commercial dual licensing available via [uxiom.support@gmail.com](mailto:uxiom.support@gmail.com).
