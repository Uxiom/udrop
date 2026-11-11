using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace UDrop {
    internal class DoubleBufferedPanel : Panel {
        public DoubleBufferedPanel() {
            this.DoubleBuffered = true;
            this.SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            this.UpdateStyles();
        }
    }

    public class GlassQrOverlayForm : Form {
        [StructLayout(LayoutKind.Sequential)]
        private struct AccentPolicy {
            public int AccentState;
            public int AccentFlags;
            public int GradientColor;
            public int AnimationId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct WindowCompositionAttributeData {
            public int Attribute;
            public IntPtr Data;
            public int SizeOfData;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MARGINS {
            public int cxLeftWidth;
            public int cxRightWidth;
            public int cyTopHeight;
            public int cyBottomHeight;
        }

        [DllImport("user32.dll")]
        private static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);

        private const int WCA_ACCENT_POLICY = 19;
        private const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        private const int DWMWCP_ROUND = 2;
        private const int DWMWA_SYSTEMBACKDROP_TYPE = 38;
        private const int DWMSBT_TRANSIENTWINDOW = 3; // True Windows 11 Acrylic frosted glass

        private struct QrParticle {
            public int R;
            public int C;
            public double Angle;
            public double RadialBoost;
            public double Stagger;
            public bool IsFinder;
        }

        private class ActiveTransferItem {
            public string FileName;
            public long FileSize;
            public long ReceivedBytes;
            public int Percent;
            public long SpeedBps;
            public string FromSlot;
            public int QueueIndex;
            public int TotalFiles;
        }

        private class CompletedTransferItem {
            public string FileName;
            public long FileSize;
            public string FilePath;
            public string FromSlot;
            public string Status;
        }

        private class OutboundFileItem {
            public string Id;
            public string Name;
            public long Size;
        }

        private class FeedHitRegion {
            public Rectangle Bounds;
            public string Kind; // "open" or "unshare"
            public string Payload;
        }

        private readonly int port;
        private readonly Action onTurnOffRequested;
        private readonly Action onOpenFolderRequested;

        // Kinetic QR Animation State
        private List<QrParticle> particles = new List<QrParticle>();
        private int qrSize = 0;
        private string mdnsUrl = "";
        private string ipUrl = "";
        private bool useIpMode = false;

        private double animProgress = 0.0; // 0 = dismantled, 1 = assembled
        private int animDir = 0;           // +1 assembling, -1 dismantling, 0 idle
        private DateTime animStartTime;
        private double animDurationMs = 480.0;
        private string dismantleCenterText = "Connected - Opening Live Hub";

        // View & Pairing Detection State
        private bool showingDashboard = false;
        private bool stayOnQrManually = false;
        private string sharedFileName = "";
        private long overlayShownEpochMs = 0;
        private long lastHandledScanMs = 0;
        private int baselineMobileCount = 0;
        private bool isShuttingDown = false;

        // Live Dashboard Snapshot Data
        private string connectedNodesSummary = "[ U ] Host  -  Waiting for devices...";
        private List<ActiveTransferItem> activeItems = new List<ActiveTransferItem>();
        private List<CompletedTransferItem> completedItems = new List<CompletedTransferItem>();
        private List<OutboundFileItem> outboundItems = new List<OutboundFileItem>();
        private List<FeedHitRegion> feedHits = new List<FeedHitRegion>();

        // Drag Window State
        private bool dragging = false;
        private Point dragStartCursor;
        private Point dragStartForm;

        // Shared Header Controls
        private Label lblTitle;
        private Label lblSubtitle;
        private Button btnSwitchView;
        private Button btnMinimize;

        // View 1: Pairing QR Controls
        private Panel panelQrView;
        private Label lblSharedFile;
        private DoubleBufferedPanel qrCanvasPanel;
        private Label lblQrStatus;
        private Label lblUrl;
        private Button btnToggleMode;
        private Button btnQrCopy;
        private Button btnQrTurnOff;

        // View 2: Live Transfer Dashboard Controls
        private Panel panelDashboardView;
        private Label lblMeshStrip;
        private Label lblDropHint;
        private DoubleBufferedPanel feedCanvasPanel;
        private Button btnShareFile;
        private Button btnDashFolder;
        private Button btnDashWeb;
        private Button btnDashTurnOff;

        // Timers
        private System.Windows.Forms.Timer animTimer;
        private System.Windows.Forms.Timer pollTimer;

        public GlassQrOverlayForm(int serverPort, Action turnOffCallback, Action openFolderCallback) {
            this.port = serverPort;
            this.onTurnOffRequested = turnOffCallback;
            this.onOpenFolderRequested = openFolderCallback;
            InitializeUi();
        }

        private void InitializeUi() {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(388, 530);
            // Pure black lets Windows DWM AcrylicBlurBehind show real frosted desktop translucency behind controls
            this.BackColor = Color.Black;
            this.ForeColor = Color.FromArgb(250, 250, 250);
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.KeyPreview = true;
            this.AllowDrop = true;
            this.DoubleBuffered = true;

            this.KeyDown += (s, e) => {
                if (e.KeyCode == Keys.Escape) {
                    HideOverlay();
                }
            };

            this.FormClosing += (s, e) => {
                if (e.CloseReason == CloseReason.UserClosing) {
                    e.Cancel = true;
                    HideOverlay();
                }
            };

            this.DragEnter += OnOverlayDragEnter;
            this.DragDrop += OnOverlayDragDrop;
            this.MouseDown += OnHeaderMouseDown;
            this.MouseMove += OnHeaderMouseMove;
            this.MouseUp += OnHeaderMouseUp;
            this.Paint += OnFormPaint;

            // Header
            lblTitle = new Label {
                Text = "[ U ]  uDrop",
                Font = new Font("Segoe UI", 12.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                AutoSize = true,
                Location = new Point(22, 16)
            };
            AttachDragHandlers(lblTitle);

            lblSubtitle = new Label {
                Text = "ACTIVE  -  SCAN QR TO PAIR",
                Font = new Font("Segoe UI", 7.75f, FontStyle.Bold),
                ForeColor = Color.FromArgb(74, 222, 128),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                AutoSize = true,
                Location = new Point(23, 41)
            };
            AttachDragHandlers(lblSubtitle);

            btnSwitchView = CreateGhostButton("Live Hub", new Point(252, 18), new Size(84, 28));
            btnSwitchView.Click += (s, e) => {
                if (showingDashboard) {
                    stayOnQrManually = true;
                    SwitchToQrView(true);
                } else {
                    stayOnQrManually = false;
                    StartDisassembleToDashboard();
                }
            };

            btnMinimize = CreateGhostButton("_", new Point(342, 18), new Size(28, 28));
            btnMinimize.Click += (s, e) => HideOverlay();

            // =================================================================
            // VIEW 1: Kinetic Pairing QR View
            // =================================================================
            panelQrView = new Panel {
                Location = new Point(0, 66),
                Size = new Size(388, 464),
                BackColor = Color.Transparent,
                AllowDrop = true
            };
            panelQrView.DragEnter += OnOverlayDragEnter;
            panelQrView.DragDrop += OnOverlayDragDrop;

            lblSharedFile = new Label {
                Text = "",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                BackColor = Color.FromArgb(28, 28, 36),
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(24, 4),
                Size = new Size(340, 24),
                Visible = false
            };

            qrCanvasPanel = new DoubleBufferedPanel {
                Location = new Point(54, 34),
                Size = new Size(280, 280),
                BackColor = Color.Black,
                AllowDrop = true
            };
            qrCanvasPanel.Paint += OnQrCanvasPaint;
            qrCanvasPanel.DragEnter += OnOverlayDragEnter;
            qrCanvasPanel.DragDrop += OnOverlayDragDrop;

            lblQrStatus = new Label {
                Text = "Point iPhone or Android camera to connect",
                Font = new Font("Segoe UI", 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(228, 228, 231),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(24, 326),
                Size = new Size(340, 22)
            };

            lblUrl = new Label {
                Text = string.Format("http://localhost:{0}", port),
                Font = new Font("Consolas", 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(184, 184, 196),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Location = new Point(24, 356),
                Size = new Size(254, 24)
            };

            btnToggleMode = CreateGhostButton("Use IP", new Point(284, 354), new Size(80, 26));
            btnToggleMode.Click += (s, e) => {
                useIpMode = !useIpMode;
                btnToggleMode.Text = useIpMode ? "Use .local" : "Use IP";
                FetchQrMatrixAndAssemble();
            };

            btnQrCopy = CreateGhostButton("Copy URL", new Point(24, 404), new Size(106, 36));
            btnQrCopy.Click += (s, e) => CopyActiveUrl(btnQrCopy);

            Button btnQrFolder = CreateGhostButton("Downloads", new Point(140, 404), new Size(108, 36));
            btnQrFolder.Click += (s, e) => {
                if (onOpenFolderRequested != null) onOpenFolderRequested();
            };

            btnQrTurnOff = CreatePrimaryButton("Turn OFF", new Point(258, 404), new Size(106, 36));
            btnQrTurnOff.Click += (s, e) => TriggerTurnOff();

            panelQrView.Controls.Add(lblSharedFile);
            panelQrView.Controls.Add(qrCanvasPanel);
            panelQrView.Controls.Add(lblQrStatus);
            panelQrView.Controls.Add(lblUrl);
            panelQrView.Controls.Add(btnToggleMode);
            panelQrView.Controls.Add(btnQrCopy);
            panelQrView.Controls.Add(btnQrFolder);
            panelQrView.Controls.Add(btnQrTurnOff);

            // =================================================================
            // VIEW 2: Live Transfer Overlay Dashboard (Revealed Post-Scan)
            // =================================================================
            panelDashboardView = new Panel {
                Location = new Point(0, 66),
                Size = new Size(388, 464),
                BackColor = Color.Transparent,
                Visible = false,
                AllowDrop = true
            };
            panelDashboardView.DragEnter += OnOverlayDragEnter;
            panelDashboardView.DragDrop += OnOverlayDragDrop;

            lblMeshStrip = new Label {
                Text = connectedNodesSummary,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(228, 228, 231),
                BackColor = Color.FromArgb(24, 24, 30),
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(10, 0, 10, 0),
                Location = new Point(20, 4),
                Size = new Size(348, 30)
            };

            lblDropHint = new Label {
                Text = "Live Transfers & Outbound Files  (Drop files anywhere to share)",
                Font = new Font("Segoe UI", 8f, FontStyle.Regular),
                ForeColor = Color.FromArgb(180, 180, 190),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                Location = new Point(20, 40),
                Size = new Size(348, 18)
            };

            feedCanvasPanel = new DoubleBufferedPanel {
                Location = new Point(20, 62),
                Size = new Size(348, 330),
                BackColor = Color.Black,
                AllowDrop = true
            };
            feedCanvasPanel.Paint += OnFeedCanvasPaint;
            feedCanvasPanel.MouseClick += OnFeedCanvasClick;
            feedCanvasPanel.MouseMove += OnFeedCanvasMouseMove;
            feedCanvasPanel.DragEnter += OnOverlayDragEnter;
            feedCanvasPanel.DragDrop += OnOverlayDragDrop;

            btnShareFile = CreatePrimaryButton("+ Share File", new Point(20, 404), new Size(94, 36));
            btnShareFile.Click += OnPickShareFilesClick;

            btnDashFolder = CreateGhostButton("Downloads", new Point(120, 404), new Size(80, 36));
            btnDashFolder.Click += (s, e) => {
                if (onOpenFolderRequested != null) onOpenFolderRequested();
            };

            btnDashWeb = CreateGhostButton("Web UI", new Point(206, 404), new Size(74, 36));
            btnDashWeb.Click += (s, e) => {
                try {
                    Process.Start(new ProcessStartInfo {
                        FileName = string.Format("http://localhost:{0}", port),
                        UseShellExecute = true
                    });
                } catch {}
            };

            btnDashTurnOff = CreateGhostButton("Turn OFF", new Point(286, 404), new Size(82, 36));
            btnDashTurnOff.Click += (s, e) => TriggerTurnOff();

            panelDashboardView.Controls.Add(lblMeshStrip);
            panelDashboardView.Controls.Add(lblDropHint);
            panelDashboardView.Controls.Add(feedCanvasPanel);
            panelDashboardView.Controls.Add(btnShareFile);
            panelDashboardView.Controls.Add(btnDashFolder);
            panelDashboardView.Controls.Add(btnDashWeb);
            panelDashboardView.Controls.Add(btnDashTurnOff);

            this.Controls.Add(lblTitle);
            this.Controls.Add(lblSubtitle);
            this.Controls.Add(btnSwitchView);
            this.Controls.Add(btnMinimize);
            this.Controls.Add(panelQrView);
            this.Controls.Add(panelDashboardView);

            animTimer = new System.Windows.Forms.Timer { Interval = 16 };
            animTimer.Tick += OnAnimationTick;

            pollTimer = new System.Windows.Forms.Timer { Interval = 350 };
            pollTimer.Tick += (s, e) => PollOverlayState();
        }

        private void AttachDragHandlers(Control ctrl) {
            ctrl.MouseDown += OnHeaderMouseDown;
            ctrl.MouseMove += OnHeaderMouseMove;
            ctrl.MouseUp += OnHeaderMouseUp;
        }

        private Button CreateGhostButton(string text, Point loc, Size size) {
            Button b = new Button {
                Text = text,
                Location = loc,
                Size = size,
                FlatStyle = FlatStyle.Flat,
                UseCompatibleTextRendering = true,
                BackColor = Color.FromArgb(24, 24, 30),
                ForeColor = Color.FromArgb(228, 228, 231),
                Font = new Font("Segoe UI", 8.25f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderColor = Color.FromArgb(62, 62, 76);
            b.FlatAppearance.BorderSize = 1;
            return b;
        }

        private Button CreatePrimaryButton(string text, Point loc, Size size) {
            Button b = new Button {
                Text = text,
                Location = loc,
                Size = size,
                FlatStyle = FlatStyle.Flat,
                UseCompatibleTextRendering = true,
                BackColor = Color.FromArgb(250, 250, 250),
                ForeColor = Color.FromArgb(9, 9, 11),
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
            ApplyGlassEffect();
        }

        private void ApplyGlassEffect() {
            try {
                int darkMode = 1;
                DwmSetWindowAttribute(this.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));
                int pref = DWMWCP_ROUND;
                DwmSetWindowAttribute(this.Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int));
            } catch {}

            try {
                MARGINS margins = new MARGINS {
                    cxLeftWidth = -1,
                    cxRightWidth = -1,
                    cyTopHeight = -1,
                    cyBottomHeight = -1
                };
                DwmExtendFrameIntoClientArea(this.Handle, ref margins);

                int backdrop = DWMSBT_TRANSIENTWINDOW;
                int hr = DwmSetWindowAttribute(this.Handle, DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, sizeof(int));
                if (hr == 0) {
                    return;
                }
            } catch {}

            // Windows 10 fallback: SetWindowCompositionAttribute Acrylic BlurBehind
            try {
                AccentPolicy accent = new AccentPolicy {
                    AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND,
                    AccentFlags = 2,
                    GradientColor = unchecked((int)0x94161412),
                    AnimationId = 0
                };
                int size = Marshal.SizeOf(accent);
                IntPtr ptr = Marshal.AllocHGlobal(size);
                try {
                    Marshal.StructureToPtr(accent, ptr, false);
                    WindowCompositionAttributeData data = new WindowCompositionAttributeData {
                        Attribute = WCA_ACCENT_POLICY,
                        Data = ptr,
                        SizeOfData = size
                    };
                    SetWindowCompositionAttribute(this.Handle, ref data);
                } finally {
                    Marshal.FreeHGlobal(ptr);
                }
            } catch {
                this.Opacity = 0.94;
            }
        }

        private static long NowUnixMs() {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        public void ShowOverlay(string sharedFile) {
            isShuttingDown = false;
            sharedFileName = sharedFile ?? "";
            overlayShownEpochMs = NowUnixMs();
            stayOnQrManually = false;

            if (!string.IsNullOrEmpty(sharedFileName)) {
                lblSharedFile.Text = string.Format("Ready to beam: {0}", sharedFileName);
                lblSharedFile.Visible = true;
            } else {
                lblSharedFile.Visible = false;
            }

            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            this.Location = new Point(
                wa.Left + (wa.Width - this.Width) / 2,
                wa.Top + (wa.Height - this.Height) / 2
            );

            SwitchToQrView(true);

            if (!this.Visible) {
                this.Show();
            }
            this.BringToFront();
            this.Activate();
            pollTimer.Start();
        }

        public void HideOverlay() {
            if (pollTimer != null) pollTimer.Stop();
            if (animTimer != null) animTimer.Stop();
            animDir = 0;
            if (this.Visible) {
                this.Hide();
            }
        }

        private void TriggerTurnOff() {
            isShuttingDown = true;
            if (!showingDashboard && particles.Count > 0) {
                dismantleCenterText = "Turning OFF...";
                StartAnimation(-1, 220.0);
                System.Windows.Forms.Timer closeT = new System.Windows.Forms.Timer { Interval = 230 };
                closeT.Tick += (s, e) => {
                    closeT.Stop();
                    closeT.Dispose();
                    HideOverlay();
                    if (onTurnOffRequested != null) onTurnOffRequested();
                };
                closeT.Start();
            } else {
                HideOverlay();
                if (onTurnOffRequested != null) onTurnOffRequested();
            }
        }

        private void SwitchToQrView(bool fetchMatrix) {
            showingDashboard = false;
            overlayShownEpochMs = NowUnixMs();
            panelDashboardView.Visible = false;
            panelQrView.Visible = true;
            btnSwitchView.Text = "Live Hub";
            lblSubtitle.Text = "ACTIVE  -  SCAN QR TO PAIR";
            lblSubtitle.ForeColor = Color.FromArgb(74, 222, 128);
            lblQrStatus.Text = string.IsNullOrEmpty(sharedFileName)
                ? "Point iPhone or Android camera to connect"
                : "Scan QR with phone to download file";

            if (fetchMatrix) {
                FetchQrMatrixAndAssemble();
            } else if (particles.Count > 0) {
                animProgress = 0.0;
                StartAnimation(1, 480.0);
            }
        }

        private void StartDisassembleToDashboard() {
            if (showingDashboard || animDir == -1) return;
            if (particles.Count == 0) {
                SwitchToDashboardView();
                return;
            }
            dismantleCenterText = "Connected - Opening Live Hub";
            lblQrStatus.Text = "Device paired! Launching Live Transfer Hub...";
            StartAnimation(-1, 520.0);
        }

        private void SwitchToDashboardView() {
            showingDashboard = true;
            stayOnQrManually = false;
            panelQrView.Visible = false;
            panelDashboardView.Visible = true;
            btnSwitchView.Text = "Show QR";
            lblSubtitle.Text = "LIVE HUB  -  TRANSFERS & SHARE";
            lblSubtitle.ForeColor = Color.FromArgb(74, 222, 128);
            PollOverlayState();
            feedCanvasPanel.Invalidate();
        }

        private void StartAnimation(int dir, double durationMs) {
            animDir = dir;
            animDurationMs = durationMs;
            animStartTime = DateTime.UtcNow;
            animTimer.Start();
        }

        private void OnAnimationTick(object sender, EventArgs e) {
            if (animDir == 0) {
                animTimer.Stop();
                return;
            }

            double elapsed = (DateTime.UtcNow - animStartTime).TotalMilliseconds;
            double frac = Math.Min(1.0, elapsed / animDurationMs);
            animProgress = animDir == 1 ? frac : (1.0 - frac);
            qrCanvasPanel.Invalidate();

            if (frac >= 1.0) {
                int doneDir = animDir;
                animDir = 0;
                animTimer.Stop();
                animProgress = doneDir == 1 ? 1.0 : 0.0;
                qrCanvasPanel.Invalidate();

                if (doneDir == -1 && !isShuttingDown) {
                    SwitchToDashboardView();
                }
            }
        }

        private void FetchQrMatrixAndAssemble() {
            string modeParam = useIpMode ? "ip" : "mdns";
            ThreadPool.QueueUserWorkItem((state) => {
                try {
                    string url = string.Format("http://127.0.0.1:{0}/api/qr.matrix?mode={1}", port, modeParam);
                    string json = HttpGet(url);
                    if (string.IsNullOrEmpty(json)) return;

                    JavaScriptSerializer ser = new JavaScriptSerializer();
                    Dictionary<string, object> data = ser.DeserializeObject(json) as Dictionary<string, object>;
                    if (data == null) return;

                    int parsedSize = Convert.ToInt32(data["size"]);
                    object[] rawRows = data["rows"] as object[];
                    string[] parsedRows = new string[rawRows.Length];
                    for (int i = 0; i < rawRows.Length; i++) {
                        parsedRows[i] = rawRows[i] != null ? rawRows[i].ToString() : "";
                    }
                    string mUrl = data.ContainsKey("mdnsUrl") ? Convert.ToString(data["mdnsUrl"]) : "";
                    string iUrl = data.ContainsKey("ipUrl") ? Convert.ToString(data["ipUrl"]) : "";

                    List<QrParticle> nextParticles = BuildParticles(parsedRows, parsedSize);

                    if (!this.IsDisposed && this.IsHandleCreated) {
                        this.BeginInvoke(new Action(() => {
                            qrSize = parsedSize;
                            particles = nextParticles;
                            mdnsUrl = mUrl;
                            ipUrl = iUrl;
                            lblUrl.Text = useIpMode ? ipUrl : mdnsUrl;
                            if (!showingDashboard) {
                                animProgress = 0.0;
                                StartAnimation(1, 480.0);
                            }
                        }));
                    }
                } catch {}
            });
        }

        private static List<QrParticle> BuildParticles(string[] rows, int size) {
            List<QrParticle> list = new List<QrParticle>();
            if (rows == null || size <= 0) return list;

            double half = (size - 1) / 2.0;
            double maxDist = Math.Sqrt(half * half * 2.0);
            if (maxDist <= 0.001) maxDist = 1.0;

            for (int r = 0; r < size && r < rows.Length; r++) {
                string row = rows[r];
                for (int c = 0; c < size && c < row.Length; c++) {
                    if (row[c] != '1') continue;
                    double dx = c - half;
                    double dy = r - half;
                    double distNorm = Math.Sqrt(dx * dx + dy * dy) / maxDist;
                    double baseAngle = Math.Atan2(dy, dx);
                    double h1 = HashUnit(r, c, 1.0);
                    double h2 = HashUnit(r, c, 2.0);
                    double swirl = (h1 - 0.5) * 1.35 + (dx == 0 && dy == 0 ? 0.5 : 0.0);
                    bool isFinder = (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

                    list.Add(new QrParticle {
                        R = r,
                        C = c,
                        Angle = baseAngle + swirl,
                        RadialBoost = 0.55 + h2 * 0.95,
                        Stagger = isFinder ? distNorm * 0.14 : distNorm * 0.28,
                        IsFinder = isFinder
                    });
                }
            }
            return list;
        }

        private static double HashUnit(int r, int c, double salt) {
            double v = Math.Sin((r + 1) * 12.9898 + (c + 1) * 78.233 + salt * 43.123) * 43758.5453;
            return v - Math.Floor(v);
        }

        private void PollOverlayState() {
            if (!this.Visible || isShuttingDown) return;
            ThreadPool.QueueUserWorkItem((state) => {
                try {
                    string json = HttpGet(string.Format("http://127.0.0.1:{0}/api/overlay/state", port));
                    if (string.IsNullOrEmpty(json)) return;

                    JavaScriptSerializer ser = new JavaScriptSerializer();
                    Dictionary<string, object> data = ser.DeserializeObject(json) as Dictionary<string, object>;
                    if (data == null) return;

                    long recentScanAt = data.ContainsKey("recentScanAt") ? Convert.ToInt64(data["recentScanAt"]) : 0;

                    List<string> nodeBadges = new List<string>();
                    int mobileCount = 0;
                    object[] ring = data.ContainsKey("ring") ? data["ring"] as object[] : null;
                    if (ring != null) {
                        for (int i = 0; i < ring.Length; i++) {
                            Dictionary<string, object> n = ring[i] as Dictionary<string, object>;
                            if (n == null) continue;
                            bool assigned = n.ContainsKey("assigned") && Convert.ToBoolean(n["assigned"]);
                            bool isHost = n.ContainsKey("isHost") && Convert.ToBoolean(n["isHost"]);
                            if (assigned) {
                                string slot = Convert.ToString(n["slot"]);
                                if (isHost) {
                                    nodeBadges.Add("[U] Host");
                                } else {
                                    mobileCount++;
                                    string name = Convert.ToString(n["name"]);
                                    nodeBadges.Add(string.Format("[{0}] {1}", slot, name));
                                }
                            }
                        }
                    }

                    List<ActiveTransferItem> nextActive = ParseActiveTransfers(data);
                    List<CompletedTransferItem> nextCompleted = ParseCompletedTransfers(data);
                    List<OutboundFileItem> nextOutbound = ParseOutboundFiles(data);

                    if (!this.IsDisposed && this.IsHandleCreated) {
                        this.BeginInvoke(new Action(() => {
                            connectedNodesSummary = mobileCount > 0
                                ? string.Join("   ", nodeBadges.ToArray())
                                : "[ U ] Host  -  Waiting for phones to pair...";
                            lblMeshStrip.Text = connectedNodesSummary;

                            activeItems = nextActive;
                            completedItems = nextCompleted;
                            outboundItems = nextOutbound;

                            if (showingDashboard) {
                                feedCanvasPanel.Invalidate();
                            } else if (!isShuttingDown) {
                                bool scanTriggered = (recentScanAt > overlayShownEpochMs && recentScanAt > lastHandledScanMs);
                                bool newDeviceConnected = stayOnQrManually
                                    ? (mobileCount > baselineMobileCount)
                                    : (mobileCount > 0);

                                if (scanTriggered || newDeviceConnected || nextActive.Count > 0) {
                                    if (recentScanAt > 0) lastHandledScanMs = recentScanAt;
                                    baselineMobileCount = mobileCount;
                                    StartDisassembleToDashboard();
                                } else {
                                    baselineMobileCount = mobileCount;
                                }
                            }
                        }));
                    }
                } catch {}
            });
        }

        private static List<ActiveTransferItem> ParseActiveTransfers(Dictionary<string, object> data) {
            List<ActiveTransferItem> list = new List<ActiveTransferItem>();
            object[] arr = data.ContainsKey("activeTransfers") ? data["activeTransfers"] as object[] : null;
            if (arr == null) return list;
            for (int i = 0; i < arr.Length; i++) {
                Dictionary<string, object> d = arr[i] as Dictionary<string, object>;
                if (d == null) continue;
                list.Add(new ActiveTransferItem {
                    FileName = Convert.ToString(d["fileName"]),
                    FileSize = Convert.ToInt64(d["fileSize"]),
                    ReceivedBytes = Convert.ToInt64(d["receivedBytes"]),
                    Percent = Convert.ToInt32(d["percent"]),
                    SpeedBps = d.ContainsKey("speedBps") ? Convert.ToInt64(d["speedBps"]) : 0,
                    FromSlot = d.ContainsKey("fromSlot") ? Convert.ToString(d["fromSlot"]) : "Node",
                    QueueIndex = d.ContainsKey("queueIndex") ? Convert.ToInt32(d["queueIndex"]) : 1,
                    TotalFiles = d.ContainsKey("totalFiles") ? Convert.ToInt32(d["totalFiles"]) : 1
                });
            }
            return list;
        }

        private static List<CompletedTransferItem> ParseCompletedTransfers(Dictionary<string, object> data) {
            List<CompletedTransferItem> list = new List<CompletedTransferItem>();
            object[] arr = data.ContainsKey("recentCompleted") ? data["recentCompleted"] as object[] : null;
            if (arr == null) return list;
            for (int i = 0; i < arr.Length; i++) {
                Dictionary<string, object> d = arr[i] as Dictionary<string, object>;
                if (d == null) continue;
                list.Add(new CompletedTransferItem {
                    FileName = Convert.ToString(d["fileName"]),
                    FileSize = Convert.ToInt64(d["fileSize"]),
                    FilePath = d.ContainsKey("filePath") ? Convert.ToString(d["filePath"]) : "",
                    FromSlot = d.ContainsKey("fromSlot") ? Convert.ToString(d["fromSlot"]) : "Node",
                    Status = d.ContainsKey("status") ? Convert.ToString(d["status"]) : "completed"
                });
            }
            return list;
        }

        private static List<OutboundFileItem> ParseOutboundFiles(Dictionary<string, object> data) {
            List<OutboundFileItem> list = new List<OutboundFileItem>();
            object[] arr = data.ContainsKey("outboundFiles") ? data["outboundFiles"] as object[] : null;
            if (arr == null) return list;
            for (int i = 0; i < arr.Length; i++) {
                Dictionary<string, object> d = arr[i] as Dictionary<string, object>;
                if (d == null) continue;
                list.Add(new OutboundFileItem {
                    Id = Convert.ToString(d["id"]),
                    Name = Convert.ToString(d["name"]),
                    Size = Convert.ToInt64(d["size"])
                });
            }
            return list;
        }

        private void OnQrCanvasPaint(object sender, PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Black);

            Rectangle glassBounds = new Rectangle(3, 3, qrCanvasPanel.Width - 7, qrCanvasPanel.Height - 7);
            DrawLiquidGlassCard(g, glassBounds, 24f, true);

            if (particles.Count == 0 || qrSize <= 0) {
                using (Font f = new Font("Segoe UI", 9f, FontStyle.Regular))
                using (SolidBrush b = new SolidBrush(Color.FromArgb(161, 161, 170))) {
                    StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                    g.DrawString("Collecting modules...", f, b, qrCanvasPanel.ClientRectangle, sf);
                }
                DrawLiquidGlassRim(g, glassBounds, 24f, true);
                return;
            }

            int pad = 22;
            int drawArea = Math.Min(qrCanvasPanel.Width, qrCanvasPanel.Height) - (pad * 2);
            double cell = (double)drawArea / qrSize;
            double maxScatter = drawArea * 0.55;
            double t = animProgress;

            for (int i = 0; i < particles.Count; i++) {
                QrParticle p = particles[i];
                double raw = Math.Max(0.0, Math.Min(1.0, (t - p.Stagger) / (1.0 - 0.28)));
                double eased = animDir == -1
                    ? (raw * raw * raw)
                    : (1.0 - Math.Pow(1.0 - raw, 3.0));

                double tx = pad + p.C * cell;
                double ty = pad + p.R * cell;
                double dist = (1.0 - eased) * maxScatter * p.RadialBoost;
                double px = tx + Math.Cos(p.Angle) * dist;
                double py = ty + Math.Sin(p.Angle) * dist;
                double scale = 0.28 + 0.72 * eased;
                int alpha = Math.Max(0, Math.Min(255, (int)(eased * 255.0)));
                if (alpha <= 4) continue;

                float drawSize = (float)Math.Ceiling(cell * scale);
                float ox = (float)(px + (cell - drawSize) * 0.5);
                float oy = (float)(py + (cell - drawSize) * 0.5);

                // Subtle white optical glow halo on etched Liquid Glass QR modules
                if (eased > 0.22) {
                    int haloAlpha = Math.Max(0, Math.Min(42, (int)(eased * 34.0)));
                    float haloPad = 1.6f;
                    using (SolidBrush halo = new SolidBrush(Color.FromArgb(haloAlpha, 255, 255, 255))) {
                        g.FillRectangle(halo, ox - haloPad, oy - haloPad, drawSize + haloPad * 2f, drawSize + haloPad * 2f);
                    }
                }

                using (SolidBrush br = new SolidBrush(Color.FromArgb(alpha, 250, 250, 255))) {
                    g.FillRectangle(br, ox, oy, drawSize, drawSize);
                }
            }

            if (animDir == -1 && t <= 0.35) {
                int msgAlpha = Math.Max(0, Math.Min(255, (int)(((0.35 - t) / 0.35) * 255.0)));
                using (Font f = new Font("Segoe UI", 10f, FontStyle.Bold))
                using (SolidBrush b = new SolidBrush(Color.FromArgb(msgAlpha, 250, 250, 250))) {
                    StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                    g.DrawString(dismantleCenterText, f, b, qrCanvasPanel.ClientRectangle, sf);
                }
            }

            DrawLiquidGlassRim(g, glassBounds, 24f, true);
        }

        private void OnFeedCanvasPaint(object sender, PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Black);
            feedHits.Clear();

            Rectangle feedRect = new Rectangle(1, 1, feedCanvasPanel.Width - 3, feedCanvasPanel.Height - 3);
            DrawLiquidGlassCard(g, feedRect, 14f, false);
            DrawLiquidGlassRim(g, feedRect, 14f, false);

            int y = 10;
            int w = feedCanvasPanel.Width - 20;

            // Section A: Active Incoming Transfers
            if (activeItems.Count > 0) {
                y = DrawSectionHeader(g, "ACTIVE TRANSFERS", 10, y);
                for (int i = 0; i < activeItems.Count && y < feedCanvasPanel.Height - 40; i++) {
                    ActiveTransferItem item = activeItems[i];
                    Rectangle rowRect = new Rectangle(10, y, w, 54);
                    DrawCardBox(g, rowRect, Color.FromArgb(26, 26, 34), Color.FromArgb(52, 52, 64));

                    string title = item.TotalFiles > 1
                        ? string.Format("[{0}/{1}] {2}", item.QueueIndex, item.TotalFiles, item.FileName)
                        : item.FileName;
                    DrawClippedText(g, title, 9f, FontStyle.Bold, Color.FromArgb(250, 250, 250), new Rectangle(20, y + 6, w - 88, 18));

                    string speedTxt = item.SpeedBps > 0
                        ? string.Format("{0:0.0} MB/s", item.SpeedBps / (1024.0 * 1024.0))
                        : string.Format("{0}%", item.Percent);
                    DrawRightText(g, speedTxt, 8.25f, FontStyle.Bold, Color.FromArgb(74, 222, 128), new Rectangle(20, y + 6, w - 20, 18));

                    // Progress track
                    Rectangle track = new Rectangle(20, y + 29, w - 20, 6);
                    using (SolidBrush tb = new SolidBrush(Color.FromArgb(40, 40, 50))) {
                        g.FillRectangle(tb, track);
                    }
                    int fillW = Math.Max(4, (int)(track.Width * (Math.Min(100, Math.Max(0, item.Percent)) / 100.0)));
                    using (SolidBrush fb = new SolidBrush(Color.FromArgb(250, 250, 250))) {
                        g.FillRectangle(fb, track.X, track.Y, fillW, track.Height);
                    }

                    string meta = string.Format("From [ {0} ]  •  {1} / {2} ({3}%)",
                        item.FromSlot, FormatBytes(item.ReceivedBytes), FormatBytes(item.FileSize), item.Percent);
                    DrawClippedText(g, meta, 7.75f, FontStyle.Regular, Color.FromArgb(161, 161, 170), new Rectangle(20, y + 37, w - 20, 14));

                    y += 60;
                }
            }

            // Section B: Host -> Phone Outbound Shared Files
            if (outboundItems.Count > 0 && y < feedCanvasPanel.Height - 36) {
                y = DrawSectionHeader(g, "SHARED FROM THIS PC (READY ON PHONES)", 10, y);
                for (int i = 0; i < outboundItems.Count && y < feedCanvasPanel.Height - 32; i++) {
                    OutboundFileItem ob = outboundItems[i];
                    Rectangle rowRect = new Rectangle(10, y, w, 34);
                    DrawCardBox(g, rowRect, Color.FromArgb(22, 22, 28), Color.FromArgb(42, 42, 52));

                    DrawClippedText(g, ob.Name, 8.5f, FontStyle.Bold, Color.FromArgb(244, 244, 245), new Rectangle(18, y + 8, w - 96, 18));
                    DrawRightText(g, FormatBytes(ob.Size), 7.75f, FontStyle.Regular, Color.FromArgb(161, 161, 170), new Rectangle(18, y + 9, w - 52, 16));

                    Rectangle unshareBtn = new Rectangle(10 + w - 28, y + 6, 22, 22);
                    DrawActionPill(g, unshareBtn, "X", Color.FromArgb(36, 36, 46), Color.FromArgb(212, 212, 216));
                    feedHits.Add(new FeedHitRegion { Bounds = unshareBtn, Kind = "unshare", Payload = ob.Id });

                    y += 39;
                }
            }

            // Section C: Recent Completed / Cancelled Transfers
            if (completedItems.Count > 0 && y < feedCanvasPanel.Height - 36) {
                y = DrawSectionHeader(g, "RECENTLY RECEIVED ON THIS PC", 10, y);
                for (int i = 0; i < completedItems.Count && y < feedCanvasPanel.Height - 32; i++) {
                    CompletedTransferItem ct = completedItems[i];
                    Rectangle rowRect = new Rectangle(10, y, w, 36);
                    DrawCardBox(g, rowRect, Color.FromArgb(22, 22, 28), Color.FromArgb(42, 42, 52));

                    bool cancelled = ct.Status == "cancelled";
                    Color pillCol = cancelled ? Color.FromArgb(248, 113, 113) : Color.FromArgb(74, 222, 128);
                    string line = string.Format("{0}  ({1})", ct.FileName, FormatBytes(ct.FileSize));
                    DrawClippedText(g, line, 8.25f, FontStyle.Bold, cancelled ? Color.FromArgb(161, 161, 170) : Color.FromArgb(244, 244, 245), new Rectangle(18, y + 9, w - 82, 18));

                    if (!cancelled && !string.IsNullOrEmpty(ct.FilePath)) {
                        Rectangle openBtn = new Rectangle(10 + w - 56, y + 7, 48, 22);
                        DrawActionPill(g, openBtn, "Open", Color.FromArgb(250, 250, 250), Color.FromArgb(9, 9, 11));
                        feedHits.Add(new FeedHitRegion { Bounds = openBtn, Kind = "open", Payload = ct.FilePath });
                    } else {
                        DrawRightText(g, cancelled ? "Cancelled" : "Done", 7.75f, FontStyle.Bold, pillCol, new Rectangle(18, y + 10, w - 18, 16));
                    }

                    y += 41;
                }
            }

            if (activeItems.Count == 0 && outboundItems.Count == 0 && completedItems.Count == 0) {
                using (Font f = new Font("Segoe UI", 9f, FontStyle.Regular))
                using (SolidBrush b = new SolidBrush(Color.FromArgb(140, 140, 152))) {
                    StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                    g.DrawString(
                        "Paired & Ready.\r\n\r\nSend photos or 4K videos from your phone,\r\nor drop files here to beam back to phones.",
                        f, b, feedCanvasPanel.ClientRectangle, sf
                    );
                }
            }
        }

        private static int DrawSectionHeader(Graphics g, string text, int x, int y) {
            using (Font f = new Font("Segoe UI", 7.25f, FontStyle.Bold))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(113, 113, 122))) {
                g.DrawString(text, f, b, x, y);
            }
            return y + 16;
        }

        private static void DrawCardBox(Graphics g, Rectangle rect, Color fill, Color border) {
            using (SolidBrush fb = new SolidBrush(fill))
            using (Pen bp = new Pen(border, 1f)) {
                g.FillRectangle(fb, rect);
                g.DrawRectangle(bp, rect.X, rect.Y, rect.Width - 1, rect.Height - 1);
            }
        }

        private static void DrawActionPill(Graphics g, Rectangle rect, string text, Color fill, Color fg) {
            using (SolidBrush fb = new SolidBrush(fill))
            using (Font f = new Font("Segoe UI", 7.5f, FontStyle.Bold))
            using (SolidBrush tb = new SolidBrush(fg)) {
                g.FillRectangle(fb, rect);
                StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(text, f, tb, rect, sf);
            }
        }

        private static void DrawClippedText(Graphics g, string text, float pt, FontStyle style, Color col, Rectangle rect) {
            using (Font f = new Font("Segoe UI", pt, style))
            using (SolidBrush b = new SolidBrush(col)) {
                StringFormat sf = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
                g.DrawString(text ?? "", f, b, rect, sf);
            }
        }

        private static void DrawRightText(Graphics g, string text, float pt, FontStyle style, Color col, Rectangle rect) {
            using (Font f = new Font("Segoe UI", pt, style))
            using (SolidBrush b = new SolidBrush(col)) {
                StringFormat sf = new StringFormat { Alignment = StringAlignment.Far, FormatFlags = StringFormatFlags.NoWrap };
                g.DrawString(text ?? "", f, b, rect, sf);
            }
        }

        private void OnFeedCanvasMouseMove(object sender, MouseEventArgs e) {
            bool overButton = false;
            for (int i = 0; i < feedHits.Count; i++) {
                if (feedHits[i].Bounds.Contains(e.Location)) {
                    overButton = true;
                    break;
                }
            }
            feedCanvasPanel.Cursor = overButton ? Cursors.Hand : Cursors.Default;
        }

        private void OnFeedCanvasClick(object sender, MouseEventArgs e) {
            for (int i = 0; i < feedHits.Count; i++) {
                FeedHitRegion hit = feedHits[i];
                if (!hit.Bounds.Contains(e.Location)) continue;

                if (hit.Kind == "open") {
                    RevealFileInExplorer(hit.Payload);
                } else if (hit.Kind == "unshare") {
                    UnshareOutboundFile(hit.Payload);
                }
                break;
            }
        }

        private void OnPickShareFilesClick(object sender, EventArgs e) {
            using (OpenFileDialog ofd = new OpenFileDialog()) {
                ofd.Multiselect = true;
                ofd.Title = "Select files to share from this PC to connected phones";
                if (ofd.ShowDialog(this) == DialogResult.OK && ofd.FileNames != null) {
                    ShareFilePaths(ofd.FileNames);
                }
            }
        }

        private void OnOverlayDragEnter(object sender, DragEventArgs e) {
            if (e.Data != null && e.Data.GetDataPresent(DataFormats.FileDrop)) {
                e.Effect = DragDropEffects.Copy;
            }
        }

        private void OnOverlayDragDrop(object sender, DragEventArgs e) {
            if (e.Data == null || !e.Data.GetDataPresent(DataFormats.FileDrop)) return;
            string[] paths = e.Data.GetData(DataFormats.FileDrop) as string[];
            if (paths != null && paths.Length > 0) {
                ShareFilePaths(paths);
                if (!showingDashboard) {
                    SwitchToDashboardView();
                }
            }
        }

        private void ShareFilePaths(string[] paths) {
            ThreadPool.QueueUserWorkItem((state) => {
                for (int i = 0; i < paths.Length; i++) {
                    string p = paths[i];
                    if (string.IsNullOrEmpty(p) || !File.Exists(p)) continue;
                    EngineHelper.RegisterOutboundFile(port, p);
                }
                PollOverlayState();
            });
        }

        private void UnshareOutboundFile(string id) {
            if (string.IsNullOrEmpty(id)) return;
            ThreadPool.QueueUserWorkItem((state) => {
                try {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/outbound/{1}", port, Uri.EscapeDataString(id)));
                    req.Method = "DELETE";
                    req.Timeout = 1500;
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {}
                } catch {}
                PollOverlayState();
            });
        }

        private void RevealFileInExplorer(string filePath) {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return;
            try {
                Process.Start(new ProcessStartInfo {
                    FileName = "explorer.exe",
                    Arguments = string.Format("/select,\"{0}\"", filePath),
                    UseShellExecute = true
                });
            } catch {}
        }

        private void CopyActiveUrl(Button targetBtn) {
            string target = useIpMode ? ipUrl : mdnsUrl;
            if (!string.IsNullOrEmpty(target)) {
                try {
                    Clipboard.SetText(target);
                    targetBtn.Text = "Copied";
                    System.Windows.Forms.Timer t = new System.Windows.Forms.Timer { Interval = 1400 };
                    t.Tick += (ts, te) => {
                        targetBtn.Text = "Copy URL";
                        t.Stop();
                        t.Dispose();
                    };
                    t.Start();
                } catch {}
            }
        }

        private static string FormatBytes(long bytes) {
            if (bytes <= 0) return "0 B";
            string[] units = { "B", "KB", "MB", "GB", "TB" };
            int idx = 0;
            double v = bytes;
            while (v >= 1024.0 && idx < units.Length - 1) {
                v /= 1024.0;
                idx++;
            }
            return string.Format("{0:0.##} {1}", v, units[idx]);
        }

        private static string HttpGet(string url) {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 1500;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) {
                return reader.ReadToEnd();
            }
        }

        private static GraphicsPath CreateRoundedRectPath(Rectangle bounds, float radius) {
            GraphicsPath path = new GraphicsPath();
            float d = radius * 2f;
            if (d > bounds.Width) d = bounds.Width;
            if (d > bounds.Height) d = bounds.Height;
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static void DrawSpecularGlint(Graphics g, float cx, float cy, float rx, float ry, int peakAlpha) {
            RectangleF rect = new RectangleF(cx - rx, cy - ry, rx * 2f, ry * 2f);
            using (GraphicsPath gp = new GraphicsPath()) {
                gp.AddEllipse(rect);
                using (PathGradientBrush pgb = new PathGradientBrush(gp)) {
                    pgb.CenterColor = Color.FromArgb(peakAlpha, 255, 255, 255);
                    pgb.SurroundColors = new Color[] { Color.FromArgb(0, 255, 255, 255) };
                    g.FillPath(pgb, gp);
                }
            }
        }

        private static void DrawLiquidGlassCard(Graphics g, Rectangle bounds, float radius, bool withDiagonalSheen) {
            using (GraphicsPath cardPath = CreateRoundedRectPath(bounds, radius)) {
                using (LinearGradientBrush bodyBrush = new LinearGradientBrush(
                    new Point(bounds.Left, bounds.Top),
                    new Point(bounds.Right, bounds.Bottom),
                    Color.FromArgb(245, 24, 25, 32),
                    Color.FromArgb(250, 10, 11, 15))) {
                    g.FillPath(bodyBrush, cardPath);
                }

                if (withDiagonalSheen) {
                    GraphicsState saved = g.Save();
                    g.SetClip(cardPath);
                    PointF[] sheenPoly = new PointF[] {
                        new PointF(bounds.Left, bounds.Top),
                        new PointF(bounds.Left + bounds.Width * 0.42f, bounds.Top),
                        new PointF(bounds.Left + bounds.Width * 0.72f, bounds.Bottom),
                        new PointF(bounds.Left + bounds.Width * 0.14f, bounds.Bottom)
                    };
                    using (LinearGradientBrush sheen = new LinearGradientBrush(
                        new PointF(bounds.Left, bounds.Top),
                        new PointF(bounds.Left + bounds.Width * 0.65f, bounds.Bottom * 0.85f),
                        Color.FromArgb(36, 255, 255, 255),
                        Color.FromArgb(0, 255, 255, 255))) {
                        g.FillPolygon(sheen, sheenPoly);
                    }
                    g.Restore(saved);
                }
            }
        }

        private static void DrawLiquidGlassRim(Graphics g, Rectangle bounds, float radius, bool drawCornerFlares) {
            using (GraphicsPath outerPath = CreateRoundedRectPath(bounds, radius)) {
                using (LinearGradientBrush rimGrad = new LinearGradientBrush(
                    new Point(bounds.Left, bounds.Top),
                    new Point(bounds.Right, bounds.Bottom),
                    Color.FromArgb(190, 255, 255, 255),
                    Color.FromArgb(150, 210, 218, 232))) {
                    ColorBlend cb = new ColorBlend(3);
                    cb.Colors = new Color[] {
                        Color.FromArgb(195, 255, 255, 255),
                        Color.FromArgb(52, 160, 168, 185),
                        Color.FromArgb(185, 240, 244, 255)
                    };
                    cb.Positions = new float[] { 0.0f, 0.48f, 1.0f };
                    rimGrad.InterpolationColors = cb;
                    using (Pen rimPen = new Pen(rimGrad, 1.6f)) {
                        g.DrawPath(rimPen, outerPath);
                    }
                }
            }

            Rectangle inner = new Rectangle(bounds.X + 1, bounds.Y + 1, bounds.Width - 2, bounds.Height - 2);
            using (GraphicsPath innerPath = CreateRoundedRectPath(inner, Math.Max(4f, radius - 1f)))
            using (Pen innerPen = new Pen(Color.FromArgb(40, 255, 255, 255), 1f)) {
                g.DrawPath(innerPen, innerPath);
            }

            if (drawCornerFlares) {
                DrawSpecularGlint(g, bounds.Left + bounds.Width * 0.74f, bounds.Top + 1f, 36f, 9f, 165);
                DrawSpecularGlint(g, bounds.Left + bounds.Width * 0.24f, bounds.Bottom - 1f, 38f, 9f, 155);
            }
        }

        private void OnFormPaint(object sender, PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle outerRect = new Rectangle(1, 1, this.Width - 3, this.Height - 3);
            DrawLiquidGlassRim(g, outerRect, 14f, true);
        }

        private void OnHeaderMouseDown(object sender, MouseEventArgs e) {
            if (e.Button == MouseButtons.Left) {
                dragging = true;
                dragStartCursor = Cursor.Position;
                dragStartForm = this.Location;
            }
        }

        private void OnHeaderMouseMove(object sender, MouseEventArgs e) {
            if (dragging) {
                Point diff = Point.Subtract(Cursor.Position, new Size(dragStartCursor));
                this.Location = Point.Add(dragStartForm, new Size(diff));
            }
        }

        private void OnHeaderMouseUp(object sender, MouseEventArgs e) {
            dragging = false;
        }
    }
}
