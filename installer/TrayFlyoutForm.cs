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

        [DllImport("user32.dll")]
        private static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private const int WCA_ACCENT_POLICY = 19;
        private const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
        private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        private const int DWMWCP_ROUND = 2;

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
        private Panel switchPanel;

        private Panel panelActive;
        private Label lblEndpointMdns;
        private Label lblEndpointIp;
        private Label lblDevices;
        private Button btnShowQr;
        private Button btnCopy;
        private Button btnFolder;
        private Button btnDash;

        private Panel panelOffline;
        private Label lblOfflineDesc;
        private Button btnTurnOnNow;

        private Label lblFooterHint;
        private Button btnQuit;

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
            this.Size = new Size(332, 310);
            this.BackColor = Color.FromArgb(12, 12, 16);
            this.ForeColor = Color.FromArgb(250, 250, 250);
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.KeyPreview = true;
            this.Opacity = 0.97;
            this.DoubleBuffered = true;

            this.Paint += (s, e) => {
                using (Pen pen = new Pen(Color.FromArgb(48, 48, 58), 1f)) {
                    e.Graphics.DrawRectangle(pen, 0, 0, this.Width - 1, this.Height - 1);
                }
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
                AutoSize = true,
                Location = new Point(20, 18)
            };

            lblHeaderSub = new Label {
                Text = "Off - Click switch to enable",
                Font = new Font("Segoe UI", 8.25f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                BackColor = Color.Transparent,
                AutoSize = true,
                Location = new Point(21, 41)
            };

            switchPanel = new Panel {
                Size = new Size(52, 28),
                Location = new Point(260, 20),
                BackColor = Color.Transparent,
                Cursor = Cursors.Hand
            };
            switchPanel.Paint += OnSwitchPaint;
            switchPanel.Click += (s, e) => TriggerToggle();

            // Active State Panel
            panelActive = new Panel {
                Location = new Point(20, 74),
                Size = new Size(292, 186),
                BackColor = Color.FromArgb(20, 20, 26),
                Visible = false
            };
            panelActive.Paint += (s, e) => {
                using (Pen p = new Pen(Color.FromArgb(40, 40, 50), 1f)) {
                    e.Graphics.DrawRectangle(p, 0, 0, panelActive.Width - 1, panelActive.Height - 1);
                }
            };

            lblEndpointMdns = new Label {
                Text = string.Format("http://localhost:{0}", port),
                Font = new Font("Consolas", 8.75f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                Location = new Point(12, 12),
                Size = new Size(268, 18)
            };

            lblEndpointIp = new Label {
                Text = "Detecting LAN IP...",
                Font = new Font("Consolas", 8f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                Location = new Point(12, 32),
                Size = new Size(268, 16)
            };

            lblDevices = new Label {
                Text = "Mesh: [ U ] Host ready",
                Font = new Font("Segoe UI", 8.25f, FontStyle.Regular),
                ForeColor = Color.FromArgb(34, 197, 94),
                Location = new Point(12, 54),
                Size = new Size(268, 18)
            };

            btnShowQr = new Button {
                Text = "Show Glass QR Overlay",
                Location = new Point(12, 82),
                Size = new Size(268, 36),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(250, 250, 250),
                ForeColor = Color.FromArgb(9, 9, 11),
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnShowQr.FlatAppearance.BorderSize = 0;
            btnShowQr.Click += (s, e) => {
                DismissFlyout();
                if (onShowGlassQr != null) onShowGlassQr();
            };

            btnCopy = CreateSubButton("Copy URL", new Point(12, 130), new Size(84, 34));
            btnCopy.Click += (s, e) => {
                string copyTarget = !string.IsNullOrEmpty(mdnsUrl) ? mdnsUrl : string.Format("http://localhost:{0}", port);
                try {
                    Clipboard.SetText(copyTarget);
                    btnCopy.Text = "Copied";
                } catch {}
            };

            btnFolder = CreateSubButton("Folder", new Point(104, 130), new Size(84, 34));
            btnFolder.Click += (s, e) => {
                DismissFlyout();
                if (onOpenFolder != null) onOpenFolder();
            };

            btnDash = CreateSubButton("Web UI", new Point(196, 130), new Size(84, 34));
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
            panelOffline = new Panel {
                Location = new Point(20, 74),
                Size = new Size(292, 186),
                BackColor = Color.FromArgb(18, 18, 22),
                Visible = true
            };
            panelOffline.Paint += (s, e) => {
                using (Pen p = new Pen(Color.FromArgb(36, 36, 44), 1f)) {
                    e.Graphics.DrawRectangle(p, 0, 0, panelOffline.Width - 1, panelOffline.Height - 1);
                }
            };

            lblOfflineDesc = new Label {
                Text = "uDrop is turned off.\r\nNo background ports or network streams are active.\r\n\r\nTurn uDrop ON to open the pairing QR overlay and receive files from any phone.",
                Font = new Font("Segoe UI", 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                Location = new Point(16, 18),
                Size = new Size(260, 102)
            };

            btnTurnOnNow = new Button {
                Text = "Turn uDrop ON",
                Location = new Point(16, 130),
                Size = new Size(260, 38),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(250, 250, 250),
                ForeColor = Color.FromArgb(9, 9, 11),
                Font = new Font("Segoe UI", 9.25f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnTurnOnNow.FlatAppearance.BorderSize = 0;
            btnTurnOnNow.Click += (s, e) => {
                if (!currentOn) TriggerToggle();
            };

            panelOffline.Controls.Add(lblOfflineDesc);
            panelOffline.Controls.Add(btnTurnOnNow);

            // Footer
            lblFooterHint = new Label {
                Text = "Hotkey: Ctrl+Shift+U",
                Font = new Font("Segoe UI", 8f, FontStyle.Regular),
                ForeColor = Color.FromArgb(113, 113, 122),
                Location = new Point(20, 274),
                AutoSize = true
            };

            btnQuit = CreateSubButton("Quit uDrop", new Point(226, 269), new Size(86, 26));
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

        private Button CreateSubButton(string text, Point loc, Size size) {
            Button b = new Button {
                Text = text,
                Location = loc,
                Size = size,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(28, 28, 34),
                ForeColor = Color.FromArgb(228, 228, 231),
                Font = new Font("Segoe UI", 8.25f, FontStyle.Regular),
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderColor = Color.FromArgb(48, 48, 58);
            b.FlatAppearance.BorderSize = 1;
            return b;
        }

        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
            try {
                int pref = DWMWCP_ROUND;
                DwmSetWindowAttribute(this.Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int));
            } catch {}

            try {
                AccentPolicy accent = new AccentPolicy {
                    AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND,
                    AccentFlags = 2,
                    GradientColor = unchecked((int)0xDF0B0909),
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
            g.SmoothingMode = SmoothingMode.AntiAlias;

            int w = switchPanel.Width - 2;
            int h = switchPanel.Height - 2;
            GraphicsPath track = CreateRoundedRect(1, 1, w, h, h / 2);

            Color trackFill = currentOn ? Color.FromArgb(250, 250, 250) : Color.FromArgb(36, 36, 44);
            Color borderColor = currentOn ? Color.FromArgb(250, 250, 250) : Color.FromArgb(72, 72, 84);
            Color thumbColor = currentOn ? Color.FromArgb(9, 9, 11) : Color.FromArgb(161, 161, 170);

            using (SolidBrush trackBrush = new SolidBrush(trackFill))
            using (Pen borderPen = new Pen(borderColor, 1.25f)) {
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

        private static GraphicsPath CreateRoundedRect(int x, int y, int w, int h, int r) {
            GraphicsPath p = new GraphicsPath();
            int d = r * 2;
            p.AddArc(x, y, d, d, 180, 90);
            p.AddArc(x + w - d, y, d, d, 270, 90);
            p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
            p.AddArc(x, y + h - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
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
