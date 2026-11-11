using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace UDrop {
    public class TrayFlyoutForm : Form {
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
        private const int DWMSBT_TRANSIENTWINDOW = 3;

        private readonly int port;
        private readonly Action<bool> onSetPowerState;
        private readonly Action onShowGlassQr;
        private readonly Action onOpenFolder;
        private readonly Action onOpenDashboard;
        private readonly Action onQuitRequested;

        private bool currentOn = false;
        private bool isBusy = false;
        private DateTime lastHiddenAt = DateTime.MinValue;
        private string mdnsUrl = "";
        private string ipUrl = "";

        // Controls
        private Label lblHeaderTitle;
        private Label lblHeaderSub;
        private DoubleBufferedPanel switchPanel;

        private DoubleBufferedPanel panelActive;
        private Label lblEndpointMdns;
        private Label lblEndpointIp;
        private Label lblDevices;
        private Button btnShowQr;
        private Button btnCopy;
        private Button btnFolder;
        private Button btnDash;

        private DoubleBufferedPanel panelOffline;
        private Label lblOfflineDesc;
        private Button btnTurnOnNow;

        private Label lblFooterHint;
        private Button btnQuit;

        private static readonly Color CardSurface = Color.FromArgb(20, 21, 27);

        public bool RecentlyDismissed {
            get { return (DateTime.UtcNow - lastHiddenAt).TotalMilliseconds < 250; }
        }

        public TrayFlyoutForm(
            int serverPort,
            Action<bool> setPowerStateCallback,
            Action showGlassQrCallback,
            Action openFolderCallback,
            Action openDashboardCallback,
            Action quitCallback
        ) {
            this.port = serverPort;
            this.onSetPowerState = setPowerStateCallback;
            this.onShowGlassQr = showGlassQrCallback;
            this.onOpenFolder = openFolderCallback;
            this.onOpenDashboard = openDashboardCallback;
            this.onQuitRequested = quitCallback;
            InitializeUi();
        }

        private void InitializeUi() {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.Size = new Size(332, 314);
            this.BackColor = Color.Black;
            this.ForeColor = Color.FromArgb(250, 250, 250);
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.KeyPreview = true;
            this.DoubleBuffered = true;

            this.Paint += (s, e) => {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                Rectangle outerRect = new Rectangle(1, 1, this.Width - 3, this.Height - 3);
                GlassDraw.DrawLiquidGlassRim(g, outerRect, 14f, true);
            };

            this.KeyDown += (s, e) => {
                if (e.KeyCode == Keys.Escape) {
                    DismissFlyout();
                }
            };

            this.Deactivate += (s, e) => {
                DismissFlyout();
            };

            this.FormClosing += (s, e) => {
                if (e.CloseReason == CloseReason.UserClosing) {
                    e.Cancel = true;
                    DismissFlyout();
                }
            };

            // Header
            lblHeaderTitle = new Label {
                Text = "[ U ]  uDrop",
                Font = new Font("Segoe UI", 12f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                AutoSize = true,
                Location = new Point(20, 18)
            };

            lblHeaderSub = new Label {
                Text = "Off - Click switch to enable",
                Font = new Font("Segoe UI", 8.25f, FontStyle.Regular),
                ForeColor = Color.FromArgb(180, 180, 190),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                AutoSize = true,
                Location = new Point(21, 41)
            };

            switchPanel = new DoubleBufferedPanel {
                Size = new Size(52, 28),
                Location = new Point(260, 20),
                BackColor = Color.Black,
                Cursor = Cursors.Hand,
                TabStop = true,
                AccessibleName = "uDrop Power Switch"
            };
            switchPanel.Paint += OnSwitchPaint;
            switchPanel.Click += (s, e) => TriggerToggle();
            switchPanel.KeyDown += (s, e) => {
                if (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter) {
                    TriggerToggle();
                    e.Handled = true;
                }
            };
            switchPanel.GotFocus += (s, e) => switchPanel.Invalidate();
            switchPanel.LostFocus += (s, e) => switchPanel.Invalidate();

            // Active State Panel
            panelActive = new DoubleBufferedPanel {
                Location = new Point(20, 74),
                Size = new Size(292, 186),
                BackColor = Color.Black,
                Visible = false
            };
            panelActive.Paint += OnInnerCardPaint;

            lblEndpointMdns = new Label {
                Text = string.Format("http://localhost:{0}", port),
                Font = new Font("Consolas", 8.75f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                BackColor = CardSurface,
                UseCompatibleTextRendering = true,
                Location = new Point(12, 12),
                Size = new Size(268, 18)
            };

            lblEndpointIp = new Label {
                Text = "Detecting LAN IP...",
                Font = new Font("Consolas", 8f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                BackColor = CardSurface,
                UseCompatibleTextRendering = true,
                Location = new Point(12, 32),
                Size = new Size(268, 16)
            };

            lblDevices = new Label {
                Text = "Mesh: [ U ] Host ready",
                Font = new Font("Segoe UI", 8.25f, FontStyle.Regular),
                ForeColor = Color.FromArgb(74, 222, 128),
                BackColor = CardSurface,
                UseCompatibleTextRendering = true,
                Location = new Point(12, 54),
                Size = new Size(268, 18)
            };

            btnShowQr = new RoundedGlassButton {
                Text = "Show Glass QR Overlay",
                Location = new Point(12, 82),
                Size = new Size(268, 36),
                IsPrimary = true,
                CornerRadius = 9f,
                CanvasBackColor = CardSurface,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                AccessibleName = "Show Glass QR Overlay"
            };
            btnShowQr.Click += (s, e) => {
                DismissFlyout();
                if (onShowGlassQr != null) onShowGlassQr();
            };

            btnCopy = CreateSubButton("Copy URL", new Point(12, 130), new Size(84, 34), CardSurface);
            btnCopy.Click += (s, e) => {
                string copyTarget = !string.IsNullOrEmpty(mdnsUrl) ? mdnsUrl : string.Format("http://localhost:{0}", port);
                try {
                    Clipboard.SetText(copyTarget);
                    btnCopy.Text = "Copied";
                } catch {}
            };

            btnFolder = CreateSubButton("Folder", new Point(104, 130), new Size(84, 34), CardSurface);
            btnFolder.Click += (s, e) => {
                DismissFlyout();
                if (onOpenFolder != null) onOpenFolder();
            };

            btnDash = CreateSubButton("Web UI", new Point(196, 130), new Size(84, 34), CardSurface);
            btnDash.Click += (s, e) => {
                DismissFlyout();
                if (onOpenDashboard != null) onOpenDashboard();
            };

            panelActive.Controls.Add(lblEndpointMdns);
            panelActive.Controls.Add(lblEndpointIp);
            panelActive.Controls.Add(lblDevices);
            panelActive.Controls.Add(btnShowQr);
            panelActive.Controls.Add(btnCopy);
            panelActive.Controls.Add(btnFolder);
            panelActive.Controls.Add(btnDash);

            // Offline State Panel
            panelOffline = new DoubleBufferedPanel {
                Location = new Point(20, 74),
                Size = new Size(292, 186),
                BackColor = Color.Black,
                Visible = true
            };
            panelOffline.Paint += OnInnerCardPaint;

            lblOfflineDesc = new Label {
                Text = "uDrop is turned off.\r\nNo background ports or network streams are active.\r\n\r\nTurn uDrop ON to open the pairing QR overlay and receive files from any phone.",
                Font = new Font("Segoe UI", 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(180, 180, 192),
                BackColor = CardSurface,
                UseCompatibleTextRendering = true,
                Location = new Point(16, 18),
                Size = new Size(260, 102)
            };

            btnTurnOnNow = new RoundedGlassButton {
                Text = "Turn uDrop ON",
                Location = new Point(16, 130),
                Size = new Size(260, 38),
                IsPrimary = true,
                CornerRadius = 9f,
                CanvasBackColor = CardSurface,
                Font = new Font("Segoe UI", 9.25f, FontStyle.Bold),
                AccessibleName = "Turn uDrop ON"
            };
            btnTurnOnNow.Click += (s, e) => {
                if (!currentOn) TriggerToggle();
            };

            panelOffline.Controls.Add(lblOfflineDesc);
            panelOffline.Controls.Add(btnTurnOnNow);

            // Footer
            lblFooterHint = new Label {
                Text = "Hotkey: Ctrl+Shift+U",
                Font = new Font("Segoe UI", 8f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = true,
                Location = new Point(20, 275),
                AutoSize = true
            };

            btnQuit = CreateSubButton("Quit uDrop", new Point(216, 269), new Size(96, 30), Color.Black);
            btnQuit.Click += (s, e) => {
                DismissFlyout();
                if (onQuitRequested != null) onQuitRequested();
            };

            this.Controls.Add(lblHeaderTitle);
            this.Controls.Add(lblHeaderSub);
            this.Controls.Add(switchPanel);
            this.Controls.Add(panelActive);
            this.Controls.Add(panelOffline);
            this.Controls.Add(lblFooterHint);
            this.Controls.Add(btnQuit);
        }

        private static void OnInnerCardPaint(object sender, PaintEventArgs e) {
            Control ctrl = sender as Control;
            if (ctrl == null) return;
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Black);
            Rectangle cardRect = new Rectangle(1, 1, ctrl.Width - 3, ctrl.Height - 3);
            using (GraphicsPath p = GlassDraw.CreateRoundedRectPath(cardRect, 12f))
            using (SolidBrush fb = new SolidBrush(CardSurface))
            using (Pen bp = new Pen(Color.FromArgb(56, 56, 70), 1f)) {
                g.FillPath(fb, p);
                g.DrawPath(bp, p);
            }
        }

        private Button CreateSubButton(string text, Point loc, Size size, Color canvasBg) {
            return new RoundedGlassButton {
                Text = text,
                Location = loc,
                Size = size,
                IsPrimary = false,
                CornerRadius = 9f,
                CanvasBackColor = canvasBg,
                Font = new Font("Segoe UI", 8.25f, FontStyle.Bold),
                AccessibleName = text
            };
        }

        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
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
                this.Opacity = 0.96;
            }
        }

        public void ShowAtTaskbarCorner(bool isOn, bool busy) {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            this.Location = new Point(wa.Right - this.Width - 12, wa.Bottom - this.Height - 12);
            UpdatePowerState(isOn, busy);
            if (!this.Visible) {
                this.Show();
            }
            this.BringToFront();
            this.Activate();
            if (isOn && !busy) {
                FetchLiveStatus();
            }
        }

        public void UpdatePowerState(bool isOn, bool busy) {
            currentOn = isOn;
            isBusy = busy;
            btnCopy.Text = "Copy URL";

            if (busy) {
                lblHeaderSub.Text = isOn ? "Stopping engine..." : "Starting engine...";
                lblHeaderSub.ForeColor = Color.FromArgb(212, 212, 216);
            } else if (isOn) {
                lblHeaderSub.Text = string.Format("Active on port {0}", port);
                lblHeaderSub.ForeColor = Color.FromArgb(34, 197, 94);
            } else {
                lblHeaderSub.Text = "Off - Click switch to enable";
                lblHeaderSub.ForeColor = Color.FromArgb(161, 161, 170);
            }

            panelActive.Visible = isOn;
            panelOffline.Visible = !isOn;
            switchPanel.Enabled = !busy;
            btnTurnOnNow.Enabled = !busy;
            switchPanel.Invalidate();
        }

        public void DismissFlyout() {
            if (this.Visible) {
                lastHiddenAt = DateTime.UtcNow;
                this.Hide();
            }
        }

        private void TriggerToggle() {
            if (isBusy) return;
            bool nextState = !currentOn;
            DismissFlyout();
            if (onSetPowerState != null) {
                onSetPowerState(nextState);
            }
        }

        private void OnSwitchPaint(object sender, PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.Clear(Color.Black);
            g.SmoothingMode = SmoothingMode.AntiAlias;

            int w = switchPanel.Width - 2;
            int h = switchPanel.Height - 2;
            GraphicsPath track = GlassDraw.CreateRoundedRectPath(new Rectangle(1, 1, w, h), h / 2f);

            Color trackFill = currentOn ? Color.FromArgb(250, 250, 250) : Color.FromArgb(36, 36, 44);
            Color borderColor = (switchPanel.Focused && this.ShowFocusCues)
                ? Color.FromArgb(250, 250, 250)
                : (currentOn ? Color.FromArgb(250, 250, 250) : Color.FromArgb(84, 84, 98));
            Color thumbColor = currentOn ? Color.FromArgb(9, 9, 11) : Color.FromArgb(212, 212, 216);

            using (SolidBrush trackBrush = new SolidBrush(trackFill))
            using (Pen borderPen = new Pen(borderColor, (switchPanel.Focused && this.ShowFocusCues) ? 1.8f : 1.25f)) {
                g.FillPath(trackBrush, track);
                g.DrawPath(borderPen, track);
            }
            track.Dispose();

            int thumbSize = h - 6;
            int thumbX = currentOn ? (1 + w - thumbSize - 3) : 4;
            int thumbY = 4;
            using (SolidBrush thumbBrush = new SolidBrush(thumbColor)) {
                g.FillEllipse(thumbBrush, thumbX, thumbY, thumbSize, thumbSize);
            }
        }

        private void FetchLiveStatus() {
            ThreadPool.QueueUserWorkItem((state) => {
                try {
                    string qrJson = HttpGet(string.Format("http://127.0.0.1:{0}/api/qr.matrix", port));
                    string ringJson = HttpGet(string.Format("http://127.0.0.1:{0}/api/mesh/ring", port));

                    JavaScriptSerializer ser = new JavaScriptSerializer();
                    Dictionary<string, object> qrData = !string.IsNullOrEmpty(qrJson) ? ser.DeserializeObject(qrJson) as Dictionary<string, object> : null;
                    Dictionary<string, object> ringData = !string.IsNullOrEmpty(ringJson) ? ser.DeserializeObject(ringJson) as Dictionary<string, object> : null;

                    string mUrl = (qrData != null && qrData.ContainsKey("mdnsUrl")) ? Convert.ToString(qrData["mdnsUrl"]) : "";
                    string iUrl = (qrData != null && qrData.ContainsKey("ipUrl")) ? Convert.ToString(qrData["ipUrl"]) : "";

                    int connectedCount = 0;
                    if (ringData != null && ringData.ContainsKey("ring")) {
                        object[] nodes = ringData["ring"] as object[];
                        if (nodes != null) {
                            for (int i = 0; i < nodes.Length; i++) {
                                Dictionary<string, object> n = nodes[i] as Dictionary<string, object>;
                                if (n != null && n.ContainsKey("assigned") && Convert.ToBoolean(n["assigned"])) {
                                    bool isHost = n.ContainsKey("isHost") && Convert.ToBoolean(n["isHost"]);
                                    if (!isHost) connectedCount++;
                                }
                            }
                        }
                    }

                    if (!this.IsDisposed && this.IsHandleCreated) {
                        this.BeginInvoke(new Action(() => {
                            mdnsUrl = mUrl;
                            ipUrl = iUrl;
                            if (!string.IsNullOrEmpty(mUrl)) lblEndpointMdns.Text = mUrl;
                            if (!string.IsNullOrEmpty(iUrl)) lblEndpointIp.Text = string.Format("Direct LAN: {0}", iUrl);
                            lblDevices.Text = connectedCount > 0
                                ? string.Format("Mesh: [ U ] Host + {0} phone(s) active", connectedCount)
                                : "Mesh: [ U ] Host ready (0 phones paired)";
                        }));
                    }
                } catch {}
            });
        }

        private static string HttpGet(string url) {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 1500;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (StreamReader r = new StreamReader(resp.GetResponseStream())) {
                return r.ReadToEnd();
            }
        }
    }
}
