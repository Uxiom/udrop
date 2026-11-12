using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace UDrop {
    static class Program {
        private const int DefaultPort = 4040;

        internal static string GetPipeName() {
            string user = Environment.UserName ?? "user";
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < user.Length; i++) {
                char ch = user[i];
                if (char.IsLetterOrDigit(ch)) sb.Append(ch);
            }
            return "UxiomUDropTrayPipe_" + sb.ToString();
        }

        private static string GetMutexName() {
            return "Local\\UxiomUDropTray_" + GetPipeName();
        }

        [STAThread]
        static void Main(string[] args) {
            try {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string pipeName = GetPipeName();
                string mutexName = GetMutexName();

                if (args.Length > 0) {
                    string cmd = args[0].ToLowerInvariant();

                    if (cmd == "--stop" || cmd == "stop") {
                        SendPipeCommand(pipeName, "STOP", 600);
                        EngineHelper.StopEngineSafely(DefaultPort);
                        return;
                    }

                    if (cmd == "--silent" || cmd == "--daemon") {
                        EngineHelper.EnsureEngineRunning(baseDir, DefaultPort);
                        return;
                    }

                    if (cmd == "--tray") {
                        bool startOn = (args.Length > 1 && args[1].ToLowerInvariant() == "--on");
                        RunSingleInstanceTray(baseDir, mutexName, pipeName, startOn, null);
                        return;
                    }

                    if (cmd == "--toggle") {
                        if (!SendPipeCommand(pipeName, "TOGGLE", 1200)) {
                            LaunchTrayAndWait(baseDir, pipeName, true);
                        }
                        return;
                    }

                    if (cmd == "--qr") {
                        if (!SendPipeCommand(pipeName, "SHOW_QR", 1200)) {
                            LaunchTrayAndWait(baseDir, pipeName, true);
                        }
                        return;
                    }

                    if (cmd == "--share" && args.Length > 1) {
                        string filePath = string.Join(" ", args, 1, args.Length - 1).Trim('"');
                        string payload = "SHARE|" + filePath;
                        if (!SendPipeCommand(pipeName, payload, 1500)) {
                            if (LaunchTrayAndWait(baseDir, pipeName, false)) {
                                SendPipeCommand(pipeName, payload, 2500);
                            } else {
                                // Direct fallback if pipe unavailable
                                EngineHelper.EnsureEngineRunning(baseDir, DefaultPort);
                                EngineHelper.RegisterOutboundFile(DefaultPort, filePath);
                            }
                        }
                        return;
                    }
                }

                // Default behavior (Desktop / Start Menu launch):
                // If Tray already running, turn ON & display Glass QR Overlay (or open flyout if active).
                // Otherwise boot single-instance Tray in ON state directly.
                if (SendPipeCommand(pipeName, "ACTIVATE_ON", 1200)) {
                    return;
                }

                RunSingleInstanceTray(baseDir, mutexName, pipeName, true, null);
            } catch (Exception ex) {
                MessageBox.Show("uDrop Launch Error: " + ex.Message, "uDrop", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private static void RunSingleInstanceTray(string baseDir, string mutexName, string pipeName, bool startOn, string initialShareFile) {
            bool createdNew = false;
            using (Mutex mutex = new Mutex(true, mutexName, out createdNew)) {
                if (!createdNew) {
                    if (startOn) {
                        SendPipeCommand(pipeName, "TURN_ON", 1200);
                    } else {
                        SendPipeCommand(pipeName, "FLYOUT", 1200);
                    }
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new UDropTrayContext(baseDir, DefaultPort, pipeName, startOn, initialShareFile));
            }
        }

        private static bool LaunchTrayAndWait(string baseDir, string pipeName, bool startOn) {
            string exePath = Process.GetCurrentProcess().MainModule.FileName;
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = exePath,
                Arguments = startOn ? "--tray --on" : "--tray",
                UseShellExecute = true,
                WorkingDirectory = baseDir
            };
            Process.Start(psi);

            for (int i = 0; i < 30; i++) {
                Thread.Sleep(100);
                if (SendPipeCommand(pipeName, "PING", 300)) {
                    return true;
                }
            }
            return false;
        }

        private static bool SendPipeCommand(string pipeName, string message, int timeoutMs) {
            try {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out)) {
                    client.Connect(timeoutMs);
                    using (StreamWriter writer = new StreamWriter(client, Encoding.UTF8)) {
                        writer.WriteLine(message);
                        writer.Flush();
                    }
                    return true;
                }
            } catch {
                return false;
            }
        }
    }

    internal static class EngineHelper {
        private static string GetStateDir() {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".udrop");
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            return dir;
        }

        private static string GetPidFile() {
            return Path.Combine(GetStateDir(), "engine.pid");
        }

        public static string GetDownloadFolder() {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "uDrop");
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            return dir;
        }

        public static bool IsEngineRunning(int port) {
            try {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/info", port));
                req.Timeout = 900;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            } catch {
                return false;
            }
        }

        public static bool EnsureEngineRunning(string baseDir, int port) {
            return EnsureEngineRunning(baseDir, port, false);
        }

        public static bool EnsureEngineRunning(string baseDir, int port, bool nativeOverlay) {
            if (IsEngineRunning(port)) return true;

            string localRuntime = Path.Combine(baseDir, "node.exe");
            string runtimePath = File.Exists(localRuntime) ? localRuntime : "node";
            string scriptPath = Path.Combine(baseDir, "bundle.cjs");

            if (!File.Exists(scriptPath)) {
                scriptPath = Path.Combine(baseDir, "..", "bin", "index.js");
            }

            if (!File.Exists(scriptPath) && !File.Exists(localRuntime)) {
                return false;
            }

            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = runtimePath,
                Arguments = string.Format("\"{0}\" --port {1} --daemon-child", scriptPath, port),
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = baseDir
            };
            if (nativeOverlay) {
                psi.EnvironmentVariables["UDROP_NATIVE_OVERLAY"] = "1";
                psi.EnvironmentVariables["UDROP_TRAY_PIPE"] = Program.GetPipeName();
            }

            try {
                Process p = Process.Start(psi);
                if (p != null) {
                    try {
                        File.WriteAllText(GetPidFile(), p.Id.ToString());
                    } catch {}
                }
                for (int i = 0; i < 35; i++) {
                    Thread.Sleep(100);
                    if (IsEngineRunning(port)) return true;
                }
            } catch {}
            return IsEngineRunning(port);
        }

        public static void StopEngineSafely(int port) {
            // 1. Ask local engine cleanly via loopback shutdown endpoint
            try {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/shutdown", port));
                req.Method = "POST";
                req.ContentLength = 0;
                req.Timeout = 1000;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {}
            } catch {}

            for (int i = 0; i < 8; i++) {
                if (!IsEngineRunning(port)) break;
                Thread.Sleep(80);
            }

            // 2. Fallback: only terminate the exact PID recorded by uDrop (never unrelated node.exe processes)
            string pidFile = GetPidFile();
            if (File.Exists(pidFile)) {
                try {
                    string raw = File.ReadAllText(pidFile).Trim();
                    int pid = 0;
                    if (int.TryParse(raw, out pid) && pid > 0) {
                        try {
                            Process proc = Process.GetProcessById(pid);
                            if (proc != null && !proc.HasExited && proc.ProcessName.ToLowerInvariant().Contains("node")) {
                                proc.Kill();
                            }
                        } catch {}
                    }
                } catch {}
                try { File.Delete(pidFile); } catch {}
            }
        }

        public static bool RegisterOutboundFile(int port, string filePath) {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return false;
            try {
                JavaScriptSerializer ser = new JavaScriptSerializer();
                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["filePath"] = filePath;
                byte[] bytes = Encoding.UTF8.GetBytes(ser.Serialize(payload));

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/outbound/register", port));
                req.Method = "POST";
                req.ContentType = "application/json";
                req.ContentLength = bytes.Length;
                req.Timeout = 2000;
                using (Stream reqStream = req.GetRequestStream()) {
                    reqStream.Write(bytes, 0, bytes.Length);
                }
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            } catch {
                return false;
            }
        }

        [DllImport("user32.dll")]
        private static extern bool AllowSetForegroundWindow(int dwProcessId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        private static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_SHOWWINDOW = 0x0040;

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        public static void RevealInExplorerAndFocus(string targetPath, bool selectFile) {
            string fallbackDir = GetDownloadFolder();
            string resolved = (targetPath ?? "").Trim().Trim('"');
            bool canSelect = selectFile && !string.IsNullOrEmpty(resolved) && File.Exists(resolved);
            string targetDir = canSelect
                ? Path.GetDirectoryName(resolved)
                : ((!string.IsNullOrEmpty(resolved) && Directory.Exists(resolved))
                    ? resolved
                    : ((!string.IsNullOrEmpty(resolved) && Directory.Exists(Path.GetDirectoryName(resolved)))
                        ? Path.GetDirectoryName(resolved)
                        : fallbackDir));
            if (string.IsNullOrEmpty(targetDir) || !Directory.Exists(targetDir)) {
                targetDir = fallbackDir;
            }

            string folderName = Path.GetFileName(targetDir.TrimEnd('\\', '/'));
            if (string.IsNullOrEmpty(folderName)) folderName = "uDrop";

            HashSet<IntPtr> preExisting = SnapshotExplorerWindows(folderName);

            try { AllowSetForegroundWindow(-1); } catch {}

            try {
                if (canSelect && !resolved.Contains(",")) {
                    Process.Start(new ProcessStartInfo {
                        FileName = "explorer.exe",
                        Arguments = string.Format("/select,\"{0}\"", resolved),
                        UseShellExecute = true
                    });
                } else {
                    Process.Start(new ProcessStartInfo {
                        FileName = "explorer.exe",
                        Arguments = string.Format("\"{0}\"", targetDir),
                        UseShellExecute = true
                    });
                }
            } catch {}

            ThreadPool.QueueUserWorkItem((state) => {
                // Prefer newly opened Explorer window first; fall back to existing matching window if Explorer reused one
                for (int attempt = 0; attempt < 18; attempt++) {
                    Thread.Sleep(attempt == 0 ? 120 : 100);
                    IntPtr found = FindExplorerWindowByFolder(folderName, preExisting);
                    if (found == IntPtr.Zero && attempt >= 6) {
                        found = FindExplorerWindowByFolder(folderName, null);
                    }
                    if (found != IntPtr.Zero) {
                        ForceBringWindowToFront(found);
                        return;
                    }
                }
            });
        }

        private static HashSet<IntPtr> SnapshotExplorerWindows(string folderName) {
            HashSet<IntPtr> set = new HashSet<IntPtr>();
            string needle = (folderName ?? "").ToLowerInvariant();
            try {
                EnumWindows((hWnd, lParam) => {
                    if (!IsWindowVisible(hWnd)) return true;
                    StringBuilder cls = new StringBuilder(64);
                    GetClassName(hWnd, cls, cls.Capacity);
                    string clsName = cls.ToString();
                    if (clsName == "CabinetWClass" || clsName == "ExploreWClass") {
                        StringBuilder title = new StringBuilder(260);
                        GetWindowText(hWnd, title, title.Capacity);
                        string titleLower = title.ToString().ToLowerInvariant();
                        if (string.IsNullOrEmpty(needle) || titleLower.Contains(needle)) {
                            set.Add(hWnd);
                        }
                    }
                    return true;
                }, IntPtr.Zero);
            } catch {}
            return set;
        }

        private static IntPtr FindExplorerWindowByFolder(string folderName, HashSet<IntPtr> excludeHandles) {
            IntPtr match = IntPtr.Zero;
            string needle = (folderName ?? "").ToLowerInvariant();
            try {
                EnumWindows((hWnd, lParam) => {
                    if (excludeHandles != null && excludeHandles.Contains(hWnd)) return true;
                    if (!IsWindowVisible(hWnd)) return true;
                    StringBuilder cls = new StringBuilder(64);
                    GetClassName(hWnd, cls, cls.Capacity);
                    string clsName = cls.ToString();
                    if (clsName == "CabinetWClass" || clsName == "ExploreWClass") {
                        StringBuilder title = new StringBuilder(260);
                        GetWindowText(hWnd, title, title.Capacity);
                        string titleLower = title.ToString().ToLowerInvariant();
                        if (string.IsNullOrEmpty(needle) || titleLower.Contains(needle)) {
                            match = hWnd;
                            return false;
                        }
                    }
                    return true;
                }, IntPtr.Zero);
            } catch {}
            return match;
        }

        private static void ForceBringWindowToFront(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero) return;
            uint curTid = GetCurrentThreadId();
            uint fgTid = 0;
            uint targetTid = 0;
            bool attachedFg = false;
            bool attachedTarget = false;
            try {
                AllowSetForegroundWindow(-1);
                IntPtr fg = GetForegroundWindow();
                uint tmpPid;
                fgTid = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out tmpPid) : 0;
                targetTid = GetWindowThreadProcessId(hwnd, out tmpPid);

                if (fgTid != 0 && fgTid != curTid) {
                    attachedFg = AttachThreadInput(curTid, fgTid, true);
                }
                if (targetTid != 0 && targetTid != curTid && targetTid != fgTid) {
                    attachedTarget = AttachThreadInput(curTid, targetTid, true);
                }

                ShowWindow(hwnd, IsIconic(hwnd) ? 9 : 5); // SW_RESTORE : SW_SHOW
                // Temporarily toggle TOPMOST -> NOTOPMOST to raise above fullscreen/active Chrome
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                BringWindowToTop(hwnd);
                SwitchToThisWindow(hwnd, true);
                SetForegroundWindow(hwnd);

                if (GetForegroundWindow() != hwnd) {
                    // Bypass Windows foreground lock when invoked asynchronously from browser IPC
                    keybd_event(0x12, 0x45, 0x0001, UIntPtr.Zero);
                    keybd_event(0x12, 0x45, 0x0001 | 0x0002, UIntPtr.Zero);
                    BringWindowToTop(hwnd);
                    SetForegroundWindow(hwnd);
                }
            } catch {
            } finally {
                try { if (attachedTarget) AttachThreadInput(curTid, targetTid, false); } catch {}
                try { if (attachedFg) AttachThreadInput(curTid, fgTid, false); } catch {}
            }
        }

        public static string FetchConnectUrl(int port) {
            try {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/qr.matrix", port));
                req.Timeout = 1000;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(resp.GetResponseStream())) {
                    string json = sr.ReadToEnd();
                    JavaScriptSerializer ser = new JavaScriptSerializer();
                    Dictionary<string, object> data = ser.DeserializeObject(json) as Dictionary<string, object>;
                    if (data != null && data.ContainsKey("mdnsUrl")) {
                        return Convert.ToString(data["mdnsUrl"]);
                    }
                }
            } catch {}
            return string.Format("http://localhost:{0}", port);
        }
    }

    internal class HotkeyWindow : NativeWindow, IDisposable {
        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private const int WM_HOTKEY = 0x0312;
        private const int HOTKEY_ID = 9001;
        private const int MOD_CONTROL = 0x0002;
        private const int MOD_SHIFT = 0x0004;

        private readonly Action onPressed;

        public HotkeyWindow(Action callback) {
            this.onPressed = callback;
            this.CreateHandle(new CreateParams());
            try {
                RegisterHotKey(this.Handle, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT, (int)Keys.U);
            } catch {}
        }

        protected override void WndProc(ref Message m) {
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID) {
                if (onPressed != null) onPressed();
            }
            base.WndProc(ref m);
        }

        public void Dispose() {
            try {
                UnregisterHotKey(this.Handle, HOTKEY_ID);
            } catch {}
            this.DestroyHandle();
        }
    }

    internal class DarkMenuRenderer : ToolStripProfessionalRenderer {
        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e) {
            using (SolidBrush b = new SolidBrush(Color.FromArgb(18, 18, 22))) {
                e.Graphics.FillRectangle(b, e.AffectedBounds);
            }
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e) {
            using (Pen p = new Pen(Color.FromArgb(46, 46, 56), 1f)) {
                e.Graphics.DrawRectangle(p, 0, 0, e.AffectedBounds.Width - 1, e.AffectedBounds.Height - 1);
            }
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e) {
            Rectangle r = new Rectangle(4, 2, e.Item.Width - 8, e.Item.Height - 4);
            Color fill = e.Item.Selected ? Color.FromArgb(38, 38, 48) : Color.FromArgb(18, 18, 22);
            using (SolidBrush b = new SolidBrush(fill)) {
                e.Graphics.FillRectangle(b, r);
            }
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e) {
            int y = e.Item.Height / 2;
            using (Pen p = new Pen(Color.FromArgb(42, 42, 52), 1f)) {
                e.Graphics.DrawLine(p, 8, y, e.Item.Width - 8, y);
            }
        }
    }

    public class UDropTrayContext : ApplicationContext {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        private readonly string baseDir;
        private readonly int port;
        private readonly string pipeName;
        private readonly Control uiMarshal;

        private NotifyIcon trayIcon;
        private ContextMenuStrip contextMenu;
        private ToolStripMenuItem menuToggleItem;
        private ToolStripMenuItem menuShowQrItem;
        private ToolStripMenuItem menuCopyUrlItem;

        private TrayFlyoutForm flyoutForm;
        private GlassQrOverlayForm glassOverlay;
        private IosNotificationForm iosToast;
        private HotkeyWindow hotkeyWindow;

        private Icon iconOn;
        private Icon iconOff;
        private bool isOn = false;
        private bool isBusy = false;
        private volatile bool shuttingDown = false;
        private System.Windows.Forms.Timer syncTimer;
        private string lastNotifiedCompletedKey = "";
        private string lastCompletedFilePath = "";
        private bool notifyBaselineSeeded = false;

        public UDropTrayContext(string dir, int serverPort, string pipe, bool startOn, string initialShare) {
            this.baseDir = dir;
            this.port = serverPort;
            this.pipeName = pipe;
            this.uiMarshal = new Control();
            IntPtr hForce = this.uiMarshal.Handle;
            if (hForce == IntPtr.Zero) {}

            iconOn = BuildMonochromeTrayIcon(true);
            iconOff = BuildMonochromeTrayIcon(false);

            glassOverlay = new GlassQrOverlayForm(
                port,
                () => SetPowerState(false, false, null),
                OpenDownloadsFolder
            );

            iosToast = new IosNotificationForm(OpenDownloadsFolder);

            flyoutForm = new TrayFlyoutForm(
                port,
                (nextState) => SetPowerState(nextState, nextState, null),
                () => {
                    if (!isOn) {
                        SetPowerState(true, true, null);
                    } else {
                        glassOverlay.ShowOverlay(null);
                    }
                },
                OpenDownloadsFolder,
                OpenWebDashboard,
                QuitTrayApp
            );

            BuildContextMenu();

            trayIcon = new NotifyIcon {
                Icon = iconOff,
                Text = "uDrop: OFF (Click to turn on)",
                ContextMenuStrip = contextMenu,
                Visible = true
            };

            trayIcon.BalloonTipClicked += (s, e) => {
                if (!string.IsNullOrEmpty(lastCompletedFilePath) && File.Exists(lastCompletedFilePath)) {
                    EngineHelper.RevealInExplorerAndFocus(lastCompletedFilePath, true);
                    return;
                }
                OpenDownloadsFolder();
            };

            trayIcon.MouseClick += (s, e) => {
                if (e.Button == MouseButtons.Left) {
                    if (flyoutForm.RecentlyDismissed) return;
                    if (flyoutForm.Visible) {
                        flyoutForm.DismissFlyout();
                    } else {
                        flyoutForm.ShowAtTaskbarCorner(isOn, isBusy);
                    }
                }
            };

            hotkeyWindow = new HotkeyWindow(() => {
                if (isBusy) return;
                SetPowerState(!isOn, !isOn, null);
            });

            StartPipeListener();

            syncTimer = new System.Windows.Forms.Timer { Interval = 1800 };
            syncTimer.Tick += (s, e) => SyncEngineStateAsync();
            syncTimer.Start();

            if (!string.IsNullOrEmpty(initialShare)) {
                HandleShareRequest(initialShare);
            } else if (startOn) {
                SetPowerState(true, true, null);
            } else {
                // Default startup state: OFF (zero port 4040 open)
                isOn = EngineHelper.IsEngineRunning(port);
                RefreshTrayUi();
            }
        }

        private void BuildContextMenu() {
            contextMenu = new ContextMenuStrip {
                Renderer = new DarkMenuRenderer(),
                ShowImageMargin = false
            };

            menuToggleItem = CreateMenuItem("Turn uDrop ON", (s, e) => SetPowerState(!isOn, !isOn, null));
            menuShowQrItem = CreateMenuItem("Show Glass Pairing QR", (s, e) => {
                if (!isOn) SetPowerState(true, true, null);
                else glassOverlay.ShowOverlay(null);
            });
            menuCopyUrlItem = CreateMenuItem("Copy Connect URL", (s, e) => {
                string u = isOn ? EngineHelper.FetchConnectUrl(port) : string.Format("http://localhost:{0}", port);
                try { Clipboard.SetText(u); } catch {}
            });

            ToolStripMenuItem menuOpenFolder = CreateMenuItem("Open Downloads Folder", (s, e) => OpenDownloadsFolder());
            ToolStripMenuItem menuOpenDash = CreateMenuItem("Open Web Dashboard", (s, e) => OpenWebDashboard());
            ToolStripMenuItem menuQuit = CreateMenuItem("Quit uDrop Tray", (s, e) => QuitTrayApp());

            contextMenu.Items.Add(menuToggleItem);
            contextMenu.Items.Add(menuShowQrItem);
            contextMenu.Items.Add(menuCopyUrlItem);
            contextMenu.Items.Add(new ToolStripSeparator());
            contextMenu.Items.Add(menuOpenFolder);
            contextMenu.Items.Add(menuOpenDash);
            contextMenu.Items.Add(new ToolStripSeparator());
            contextMenu.Items.Add(menuQuit);
        }

        private ToolStripMenuItem CreateMenuItem(string text, EventHandler onClick) {
            ToolStripMenuItem item = new ToolStripMenuItem(text) {
                ForeColor = Color.FromArgb(244, 244, 245),
                Font = new Font("Segoe UI", 9f, FontStyle.Regular)
            };
            item.Click += onClick;
            return item;
        }

        private void RefreshTrayUi() {
            trayIcon.Icon = isOn ? iconOn : iconOff;
            trayIcon.Text = isBusy
                ? "uDrop: Updating state..."
                : (isOn ? string.Format("uDrop: ON (Port {0})", port) : "uDrop: OFF (Click to turn on)");

            menuToggleItem.Text = isOn ? "Turn uDrop OFF" : "Turn uDrop ON";
            menuShowQrItem.Enabled = !isBusy;
            menuCopyUrlItem.Enabled = isOn && !isBusy;

            if (flyoutForm.Visible) {
                flyoutForm.UpdatePowerState(isOn, isBusy);
            }
        }

        private void SetPowerState(bool targetOn, bool showOverlayOnEnable, string shareFilePath) {
            if (isBusy) return;
            isBusy = true;
            RefreshTrayUi();

            if (!targetOn) {
                glassOverlay.HideOverlay();
                if (iosToast != null) iosToast.DismissBanner();
                notifyBaselineSeeded = false;
                lastNotifiedCompletedKey = "";
            }

            ThreadPool.QueueUserWorkItem((state) => {
                bool resultOn = false;
                if (targetOn) {
                    resultOn = EngineHelper.EnsureEngineRunning(baseDir, port, true);
                    if (resultOn && !string.IsNullOrEmpty(shareFilePath)) {
                        EngineHelper.RegisterOutboundFile(port, shareFilePath);
                    }
                } else {
                    EngineHelper.StopEngineSafely(port);
                    resultOn = false;
                }

                PostToUi(() => {
                    isOn = resultOn;
                    isBusy = false;
                    RefreshTrayUi();
                    if (isOn && showOverlayOnEnable) {
                        string labelName = !string.IsNullOrEmpty(shareFilePath) ? Path.GetFileName(shareFilePath) : null;
                        glassOverlay.ShowOverlay(labelName);
                    }
                });
            });
        }

        private void HandleShareRequest(string filePath) {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return;
            if (!isOn) {
                SetPowerState(true, true, filePath);
                return;
            }
            ThreadPool.QueueUserWorkItem((state) => {
                EngineHelper.RegisterOutboundFile(port, filePath);
                PostToUi(() => {
                    glassOverlay.ShowOverlay(Path.GetFileName(filePath));
                });
            });
        }

        private void SyncEngineStateAsync() {
            if (isBusy || shuttingDown) return;
            ThreadPool.QueueUserWorkItem((state) => {
                bool alive = EngineHelper.IsEngineRunning(port);
                string newestKey = null;
                string newestName = null;
                string newestPath = null;
                long newestSize = 0;
                string newestFrom = null;

                if (alive) {
                    try {
                        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/overlay/state", port));
                        req.Timeout = 1000;
                        using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                        using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) {
                            JavaScriptSerializer ser = new JavaScriptSerializer();
                            Dictionary<string, object> data = ser.DeserializeObject(sr.ReadToEnd()) as Dictionary<string, object>;
                            object[] recents = (data != null && data.ContainsKey("recentCompleted")) ? data["recentCompleted"] as object[] : null;
                            if (recents != null && recents.Length > 0) {
                                Dictionary<string, object> top = recents[0] as Dictionary<string, object>;
                                if (top != null) {
                                    string st = top.ContainsKey("status") ? Convert.ToString(top["status"]) : "completed";
                                    if (st == "completed") {
                                        newestName = top.ContainsKey("fileName") ? Convert.ToString(top["fileName"]) : "";
                                        newestPath = top.ContainsKey("filePath") ? Convert.ToString(top["filePath"]) : "";
                                        newestSize = top.ContainsKey("fileSize") ? Convert.ToInt64(top["fileSize"]) : 0;
                                        newestFrom = top.ContainsKey("fromSlot") ? Convert.ToString(top["fromSlot"]) : "Peer";
                                        string ts = top.ContainsKey("timestamp") ? Convert.ToString(top["timestamp"]) : "";
                                        newestKey = newestName + "|" + newestPath + "|" + ts;
                                    }
                                }
                            }
                        }
                    } catch {}
                }

                PostToUi(() => {
                    if (shuttingDown) return;
                    if (alive != isOn && !isBusy) {
                        isOn = alive;
                        if (!isOn) {
                            glassOverlay.HideOverlay();
                            notifyBaselineSeeded = false;
                            lastNotifiedCompletedKey = "";
                        }
                        RefreshTrayUi();
                    }
                    if (alive && !string.IsNullOrEmpty(newestKey)) {
                        if (!notifyBaselineSeeded) {
                            notifyBaselineSeeded = true;
                            lastNotifiedCompletedKey = newestKey;
                            lastCompletedFilePath = newestPath;
                        } else if (newestKey != lastNotifiedCompletedKey) {
                            lastNotifiedCompletedKey = newestKey;
                            lastCompletedFilePath = newestPath;
                            string sizeLabel = FormatBytesBrief(newestSize);
                            iosToast.ShowNotification(
                                "File Received",
                                newestName,
                                string.Format("{0}  •  From [ {1} ]  •  Downloads\\uDrop", sizeLabel, newestFrom),
                                newestPath
                            );
                        }
                    } else if (alive && !notifyBaselineSeeded) {
                        notifyBaselineSeeded = true;
                    }
                });
            });
        }

        private static string FormatBytesBrief(long bytes) {
            if (bytes <= 0) return "0 B";
            string[] u = { "B", "KB", "MB", "GB" };
            int i = 0;
            double v = bytes;
            while (v >= 1024.0 && i < u.Length - 1) { v /= 1024.0; i++; }
            return string.Format("{0:0.#} {1}", v, u[i]);
        }

        private void StartPipeListener() {
            Thread listenerThread = new Thread(() => {
                while (!shuttingDown) {
                    try {
                        using (NamedPipeServerStream server = new NamedPipeServerStream(pipeName, PipeDirection.In, 4)) {
                            server.WaitForConnection();
                            if (shuttingDown) break;
                            using (StreamReader reader = new StreamReader(server, Encoding.UTF8)) {
                                string cmd = reader.ReadLine();
                                if (!string.IsNullOrEmpty(cmd)) {
                                    HandleIpcCommand(cmd.Trim());
                                }
                            }
                        }
                    } catch {
                        Thread.Sleep(200);
                    }
                }
            });
            listenerThread.IsBackground = true;
            listenerThread.Start();
        }

        private void HandleIpcCommand(string cmd) {
            PostToUi(() => {
                if (cmd == "PING") {
                    return;
                }
                if (cmd == "FLYOUT") {
                    flyoutForm.ShowAtTaskbarCorner(isOn, isBusy);
                } else if (cmd == "TURN_ON" || cmd == "ACTIVATE_ON") {
                    if (!isOn) SetPowerState(true, true, null);
                    else glassOverlay.ShowOverlay(null);
                } else if (cmd == "SHOW_QR") {
                    if (!isOn) SetPowerState(true, true, null);
                    else glassOverlay.ShowOverlay(null);
                } else if (cmd == "TOGGLE") {
                    SetPowerState(!isOn, !isOn, null);
                } else if (cmd == "STOP") {
                    if (isOn) SetPowerState(false, false, null);
                } else if (cmd.StartsWith("SHARE|")) {
                    string path = cmd.Substring("SHARE|".Length);
                    HandleShareRequest(path);
                } else if (cmd.StartsWith("REVEAL|")) {
                    string path = cmd.Substring("REVEAL|".Length);
                    EngineHelper.RevealInExplorerAndFocus(path, true);
                } else if (cmd.StartsWith("OPENDIR|")) {
                    string path = cmd.Substring("OPENDIR|".Length);
                    EngineHelper.RevealInExplorerAndFocus(path, false);
                }
            });
        }

        private void PostToUi(Action action) {
            if (shuttingDown || uiMarshal == null || uiMarshal.IsDisposed) return;
            try {
                if (uiMarshal.InvokeRequired) {
                    uiMarshal.BeginInvoke(new Action(() => {
                        if (!shuttingDown) action();
                    }));
                } else {
                    if (!shuttingDown) action();
                }
            } catch {}
        }

        private void OpenDownloadsFolder() {
            EngineHelper.RevealInExplorerAndFocus(EngineHelper.GetDownloadFolder(), false);
        }

        private void OpenWebDashboard() {
            if (!isOn) {
                SetPowerState(true, false, null);
            }
            try {
                Process.Start(new ProcessStartInfo {
                    FileName = string.Format("http://localhost:{0}?pair=1", port),
                    UseShellExecute = true
                });
            } catch {}
        }

        private void QuitTrayApp() {
            shuttingDown = true;
            if (syncTimer != null) syncTimer.Stop();
            if (hotkeyWindow != null) hotkeyWindow.Dispose();
            glassOverlay.HideOverlay();
            if (iosToast != null) iosToast.DismissBanner();
            flyoutForm.DismissFlyout();
            trayIcon.Visible = false;

            if (isOn) {
                EngineHelper.StopEngineSafely(port);
            }
            if (iconOn != null) DestroyIconSafe(iconOn);
            if (iconOff != null) DestroyIconSafe(iconOff);
            Application.ExitThread();
        }

        private static void DestroyIconSafe(Icon ico) {
            try {
                IntPtr h = ico.Handle;
                ico.Dispose();
                DestroyIcon(h);
            } catch {}
        }

        private static Icon BuildMonochromeTrayIcon(bool active) {
            Bitmap bmp = new Bitmap(32, 32);
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);

                Color circleFill = active ? Color.FromArgb(250, 250, 250) : Color.FromArgb(50, 50, 58);
                Color borderCol = active ? Color.FromArgb(250, 250, 250) : Color.FromArgb(128, 128, 140);
                Color textCol = active ? Color.FromArgb(9, 9, 11) : Color.FromArgb(200, 200, 210);

                using (SolidBrush fillBrush = new SolidBrush(circleFill))
                using (Pen borderPen = new Pen(borderCol, 2f)) {
                    g.FillEllipse(fillBrush, 2, 2, 28, 28);
                    if (!active) g.DrawEllipse(borderPen, 3, 3, 26, 26);
                }

                using (Font f = new Font("Segoe UI", 14.5f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (SolidBrush textBrush = new SolidBrush(textCol)) {
                    StringFormat sf = new StringFormat {
                        Alignment = StringAlignment.Center,
                        LineAlignment = StringAlignment.Center
                    };
                    g.DrawString("U", f, textBrush, new RectangleF(1, 2, 30, 28), sf);
                }

                if (active) {
                    using (SolidBrush dotBrush = new SolidBrush(Color.FromArgb(34, 197, 94))) {
                        g.FillEllipse(dotBrush, 22, 22, 9, 9);
                    }
                }
            }
            IntPtr hIcon = bmp.GetHicon();
            Icon created = Icon.FromHandle(hIcon);
            Icon clone = (Icon)created.Clone();
            DestroyIcon(hIcon);
            bmp.Dispose();
            return clone;
        }
    }
}
