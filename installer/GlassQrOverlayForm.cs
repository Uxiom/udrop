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
    internal static class GlassDraw {
        public static GraphicsPath CreateRoundedRectPath(Rectangle bounds, float radius) {
            GraphicsPath path = new GraphicsPath();
            float d = radius * 2f;
            if (d > bounds.Width) d = bounds.Width;
            if (d > bounds.Height) d = bounds.Height;
            if (d <= 0.5f) {
                path.AddRectangle(bounds);
                return path;
            }
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void DrawSpecularGlint(Graphics g, float cx, float cy, float rx, float ry, int peakAlpha) {
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

        public static void DrawLiquidGlassCard(Graphics g, Rectangle bounds, float radius, bool withDiagonalSheen) {
            using (GraphicsPath cardPath = CreateRoundedRectPath(bounds, radius)) {
                GraphicsState saved = g.Save();
                g.SetClip(cardPath);

                // Keep base Color.Black untouched in the core so Windows DWM Acrylic shows live blurred desktop straight through!
                // Paint only soft convex top-edge meniscus light + subtle optical glass sheen fading to 0 alpha.
                int domeHeight = Math.Max(28, (int)(bounds.Height * 0.34f));
                using (LinearGradientBrush domeBrush = new LinearGradientBrush(
                    new Point(bounds.Left, bounds.Top),
                    new Point(bounds.Left, bounds.Top + domeHeight),
                    Color.FromArgb(withDiagonalSheen ? 38 : 22, 255, 255, 255),
                    Color.FromArgb(0, 255, 255, 255))) {
                    g.FillRectangle(domeBrush, bounds.Left, bounds.Top, bounds.Width, domeHeight);
                }

                if (withDiagonalSheen) {
                    PointF[] sheenPoly = new PointF[] {
                        new PointF(bounds.Left, bounds.Top),
                        new PointF(bounds.Left + bounds.Width * 0.44f, bounds.Top),
                        new PointF(bounds.Left + bounds.Width * 0.74f, bounds.Bottom),
                        new PointF(bounds.Left + bounds.Width * 0.14f, bounds.Bottom)
                    };
                    using (LinearGradientBrush sheen = new LinearGradientBrush(
                        new PointF(bounds.Left, bounds.Top),
                        new PointF(bounds.Left + bounds.Width * 0.65f, bounds.Bottom * 0.85f),
                        Color.FromArgb(40, 255, 255, 255),
                        Color.FromArgb(0, 255, 255, 255))) {
                        g.FillPolygon(sheen, sheenPoly);
                    }
                }
                g.Restore(saved);
            }
        }

        public static void DrawLiquidGlassRim(Graphics g, Rectangle bounds, float radius, bool drawCornerFlares) {
            using (GraphicsPath outerPath = CreateRoundedRectPath(bounds, radius)) {
                using (LinearGradientBrush rimGrad = new LinearGradientBrush(
                    new Point(bounds.Left, bounds.Top),
                    new Point(bounds.Right, bounds.Bottom),
                    Color.FromArgb(228, 255, 255, 255),
                    Color.FromArgb(205, 232, 240, 255))) {
                    ColorBlend cb = new ColorBlend(3);
                    cb.Colors = new Color[] {
                        Color.FromArgb(228, 255, 255, 255),
                        Color.FromArgb(62, 185, 198, 220),
                        Color.FromArgb(214, 244, 248, 255)
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
            using (Pen innerPen = new Pen(Color.FromArgb(64, 255, 255, 255), 1f)) {
                g.DrawPath(innerPen, innerPath);
            }

            if (drawCornerFlares) {
                DrawSpecularGlint(g, bounds.Left + bounds.Width * 0.74f, bounds.Top + 1f, 38f, 9f, 205);
                DrawSpecularGlint(g, bounds.Left + bounds.Width * 0.24f, bounds.Bottom - 1f, 40f, 9f, 190);
            }
        }
    }

    internal class DoubleBufferedPanel : Panel {
        public DoubleBufferedPanel() {
            this.DoubleBuffered = true;
            this.SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            this.UpdateStyles();
        }
    }

    internal class RoundedGlassButton : Button {
        public bool IsPrimary { get; set; }
        public bool IsMinimizeIcon { get; set; }
        public float CornerRadius { get; set; }
        public Color CanvasBackColor { get; set; }

        private bool isHovered = false;
        private bool isPressed = false;

        public RoundedGlassButton() {
            CornerRadius = 10f;
            CanvasBackColor = Color.Black;
            this.FlatStyle = FlatStyle.Flat;
            this.TabStop = true;
            this.Cursor = Cursors.Hand;
            this.SetStyle(
                ControlStyles.AllPaintingInWmPaint |
                ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw,
                true
            );
            this.UpdateStyles();
        }

        protected override void OnMouseEnter(EventArgs e) {
            isHovered = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e) {
            isHovered = false;
            isPressed = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs mevent) {
            if (mevent.Button == MouseButtons.Left) {
                isPressed = true;
                Invalidate();
            }
            base.OnMouseDown(mevent);
        }

        protected override void OnMouseUp(MouseEventArgs mevent) {
            isPressed = false;
            Invalidate();
            base.OnMouseUp(mevent);
        }

        protected override void OnPaintBackground(PaintEventArgs pevent) {
            // Paint handled smoothly inside OnPaint
        }

        protected override void OnPaint(PaintEventArgs pevent) {
            Graphics g = pevent.Graphics;
            g.Clear(CanvasBackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            Rectangle rect = new Rectangle(1, 1, Math.Max(4, this.Width - 3), Math.Max(4, this.Height - 3));
            float r = Math.Min(CornerRadius, Math.Min(rect.Width, rect.Height) / 2f);

            Color fillCol;
            Color borderCol;
            Color textCol;

            if (IsPrimary) {
                fillCol = !this.Enabled
                    ? Color.FromArgb(140, 140, 148)
                    : (isPressed ? Color.FromArgb(212, 212, 216) : (isHovered ? Color.FromArgb(232, 232, 236) : Color.FromArgb(250, 250, 250)));
                borderCol = Color.FromArgb(255, 255, 255);
                textCol = Color.FromArgb(9, 9, 11);
            } else {
                fillCol = isPressed
                    ? Color.FromArgb(248, 46, 46, 58)
                    : (isHovered ? Color.FromArgb(245, 34, 34, 44) : Color.FromArgb(240, 22, 22, 30));
                borderCol = (this.Focused && this.ShowFocusCues)
                    ? Color.FromArgb(220, 250, 250, 250)
                    : (isHovered ? Color.FromArgb(130, 130, 152) : Color.FromArgb(62, 62, 76));
                textCol = this.Enabled ? Color.FromArgb(244, 244, 245) : Color.FromArgb(113, 113, 122);
            }

            using (GraphicsPath path = GlassDraw.CreateRoundedRectPath(rect, r))
            using (SolidBrush fill = new SolidBrush(fillCol))
            using (Pen border = new Pen(borderCol, (this.Focused && this.ShowFocusCues) ? 1.5f : 1f)) {
                g.FillPath(fill, path);
                g.DrawPath(border, path);
            }

            if (IsPrimary && this.Focused && this.ShowFocusCues) {
                Rectangle focusRect = new Rectangle(rect.X + 2, rect.Y + 2, Math.Max(2, rect.Width - 4), Math.Max(2, rect.Height - 4));
                using (GraphicsPath fp = GlassDraw.CreateRoundedRectPath(focusRect, Math.Max(2f, r - 2f)))
                using (Pen fpen = new Pen(Color.FromArgb(9, 9, 11), 1.25f)) {
                    g.DrawPath(fpen, fp);
                }
            }

            if (IsMinimizeIcon) {
                int cx = this.Width / 2;
                int cy = this.Height / 2;
                using (Pen minPen = new Pen(isHovered ? Color.FromArgb(250, 250, 250) : Color.FromArgb(212, 212, 216), 2f)) {
                    minPen.StartCap = LineCap.Round;
                    minPen.EndCap = LineCap.Round;
                    g.DrawLine(minPen, cx - 5, cy, cx + 5, cy);
                }
            } else {
                StringFormat sf = new StringFormat {
                    Alignment = StringAlignment.Center,
                    LineAlignment = StringAlignment.Center,
                    Trimming = StringTrimming.EllipsisCharacter,
                    FormatFlags = StringFormatFlags.NoWrap
                };
                using (SolidBrush tb = new SolidBrush(textCol)) {
                    g.DrawString(this.Text ?? "", this.Font, tb, new RectangleF(4, 1, this.Width - 8, this.Height - 2), sf);
                }
            }
        }
    }

    internal class RoundedBannerLabel : Label {
        public float CornerRadius { get; set; }
        public Color PillBackColor { get; set; }
        public Color PillBorderColor { get; set; }
        public Color CanvasBackColor { get; set; }
        public int HorizontalInset { get; set; }

        public RoundedBannerLabel() {
            CornerRadius = 9f;
            PillBackColor = Color.FromArgb(242, 24, 24, 32);
            PillBorderColor = Color.FromArgb(56, 56, 70);
            CanvasBackColor = Color.Black;
            HorizontalInset = 12;
            this.AutoSize = false;
            this.DoubleBuffered = true;
            this.SetStyle(
                ControlStyles.AllPaintingInWmPaint |
                ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw,
                true
            );
            this.UpdateStyles();
        }

        protected override void OnPaintBackground(PaintEventArgs pevent) {
            // Paint handled smoothly inside OnPaint
        }

        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.Clear(CanvasBackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            Rectangle rect = new Rectangle(1, 1, Math.Max(4, this.Width - 3), Math.Max(4, this.Height - 3));
            float r = Math.Min(CornerRadius, Math.Min(rect.Width, rect.Height) / 2f);
            using (GraphicsPath path = GlassDraw.CreateRoundedRectPath(rect, r))
            using (SolidBrush fill = new SolidBrush(PillBackColor))
            using (Pen border = new Pen(PillBorderColor, 1f)) {
                g.FillPath(fill, path);
                g.DrawPath(border, path);
            }

            StringFormat sf = new StringFormat {
                Alignment = (this.TextAlign == ContentAlignment.MiddleCenter || this.TextAlign == ContentAlignment.TopCenter || this.TextAlign == ContentAlignment.BottomCenter)
                    ? StringAlignment.Center
                    : StringAlignment.Near,
                LineAlignment = StringAlignment.Center,
                Trimming = StringTrimming.EllipsisCharacter,
                FormatFlags = StringFormatFlags.NoWrap
            };
            RectangleF textBounds = new RectangleF(HorizontalInset, 0, Math.Max(8, this.Width - HorizontalInset * 2), this.Height);
            using (SolidBrush tb = new SolidBrush(this.ForeColor)) {
                g.DrawString(this.Text ?? "", this.Font, tb, textBounds, sf);
            }
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
        private int hoveredHitIndex = -1;
        private int focusedHitIndex = -1;
        private string receivedBannerText = "";
        private long receivedBannerUntilMs = 0;
        private string lastBannerCompletedKey = "";
        private bool bannerBaselineSeeded = false;

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

            btnMinimize = new RoundedGlassButton {
                Text = "Minimize",
                IsMinimizeIcon = true,
                CornerRadius = 9f,
                Location = new Point(342, 18),
                Size = new Size(28, 28),
                AccessibleName = "Minimize to Tray",
                AccessibleDescription = "Hide overlay to taskbar tray (Esc)"
            };
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

            lblSharedFile = new RoundedBannerLabel {
                Text = "",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                PillBackColor = Color.FromArgb(242, 26, 26, 34),
                PillBorderColor = Color.FromArgb(66, 66, 82),
                CornerRadius = 9f,
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

            lblMeshStrip = new RoundedBannerLabel {
                Text = connectedNodesSummary,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(236, 236, 240),
                PillBackColor = Color.FromArgb(242, 22, 22, 30),
                PillBorderColor = Color.FromArgb(56, 56, 70),
                CornerRadius = 9f,
                HorizontalInset = 12,
                TextAlign = ContentAlignment.MiddleLeft,
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
                AllowDrop = true,
                TabStop = true,
                AccessibleName = "Live Transfer Activity Feed"
            };
            feedCanvasPanel.Paint += OnFeedCanvasPaint;
            feedCanvasPanel.MouseClick += OnFeedCanvasClick;
            feedCanvasPanel.MouseMove += OnFeedCanvasMouseMove;
            feedCanvasPanel.MouseLeave += (s, e) => {
                if (hoveredHitIndex != -1) {
                    hoveredHitIndex = -1;
                    feedCanvasPanel.Cursor = Cursors.Default;
                    feedCanvasPanel.Invalidate();
                }
            };
            feedCanvasPanel.GotFocus += (s, e) => {
                if (feedHits.Count > 0 && focusedHitIndex < 0) {
                    focusedHitIndex = 0;
                    feedCanvasPanel.Invalidate();
                }
            };
            feedCanvasPanel.LostFocus += (s, e) => {
                if (focusedHitIndex != -1) {
                    focusedHitIndex = -1;
                    feedCanvasPanel.Invalidate();
                }
            };
            feedCanvasPanel.PreviewKeyDown += (s, e) => {
                if (e.KeyCode == Keys.Up || e.KeyCode == Keys.Down || e.KeyCode == Keys.Left || e.KeyCode == Keys.Right) {
                    e.IsInputKey = true;
                }
            };
            feedCanvasPanel.KeyDown += OnFeedCanvasKeyDown;
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
            return new RoundedGlassButton {
                Text = text,
                Location = loc,
                Size = size,
                IsPrimary = false,
                CornerRadius = 9f,
                Font = new Font("Segoe UI", 8.25f, FontStyle.Bold),
                AccessibleName = text
            };
        }

        private Button CreatePrimaryButton(string text, Point loc, Size size) {
            return new RoundedGlassButton {
                Text = text,
                Location = loc,
                Size = size,
                IsPrimary = true,
                CornerRadius = 9f,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                AccessibleName = text
            };
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
                                StartAnimation(1, 320.0);
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

                            if (nextCompleted.Count > 0 && nextCompleted[0].Status == "completed") {
                                CompletedTransferItem top = nextCompleted[0];
                                string cKey = top.FileName + "|" + top.FilePath + "|" + top.FileSize;
                                if (!bannerBaselineSeeded) {
                                    bannerBaselineSeeded = true;
                                    lastBannerCompletedKey = cKey;
                                } else if (cKey != lastBannerCompletedKey) {
                                    lastBannerCompletedKey = cKey;
                                    receivedBannerText = string.Format("File Received: {0} ({1})", top.FileName, FormatBytes(top.FileSize));
                                    receivedBannerUntilMs = NowUnixMs() + 5500;
                                }
                            } else if (!bannerBaselineSeeded) {
                                bannerBaselineSeeded = true;
                            }

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
            GlassDraw.DrawLiquidGlassCard(g, glassBounds, 24f, true);

            if (particles.Count == 0 || qrSize <= 0) {
                using (Font f = new Font("Segoe UI", 9f, FontStyle.Regular))
                using (SolidBrush b = new SolidBrush(Color.FromArgb(161, 161, 170))) {
                    StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                    g.DrawString("Collecting modules...", f, b, qrCanvasPanel.ClientRectangle, sf);
                }
                GlassDraw.DrawLiquidGlassRim(g, glassBounds, 24f, true);
                return;
            }

            int pad = 22;
            int drawArea = Math.Min(qrCanvasPanel.Width, qrCanvasPanel.Height) - (pad * 2);
            double cell = (double)drawArea / qrSize;
            double maxScatter = drawArea * 0.55;
            double t = animProgress;

            using (SolidBrush halo = new SolidBrush(Color.FromArgb(30, 255, 255, 255)))
            using (SolidBrush br = new SolidBrush(Color.FromArgb(250, 250, 255))) {
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

                    if (eased > 0.25) {
                        int haloAlpha = Math.Max(0, Math.Min(40, (int)(eased * 32.0)));
                        float haloPad = 1.5f;
                        halo.Color = Color.FromArgb(haloAlpha, 255, 255, 255);
                        g.FillRectangle(halo, ox - haloPad, oy - haloPad, drawSize + haloPad * 2f, drawSize + haloPad * 2f);
                    }

                    br.Color = Color.FromArgb(alpha, 250, 250, 255);
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

            GlassDraw.DrawLiquidGlassRim(g, glassBounds, 24f, true);
        }

        private void OnFeedCanvasPaint(object sender, PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            g.Clear(Color.Black);
            feedHits.Clear();

            Rectangle feedRect = new Rectangle(1, 1, feedCanvasPanel.Width - 3, feedCanvasPanel.Height - 3);
            GlassDraw.DrawLiquidGlassCard(g, feedRect, 14f, false);
            GlassDraw.DrawLiquidGlassRim(g, feedRect, 14f, false);

            int y = 10;
            int w = feedCanvasPanel.Width - 20;

            if (!string.IsNullOrEmpty(receivedBannerText) && NowUnixMs() < receivedBannerUntilMs) {
                Rectangle toastRect = new Rectangle(10, y, w, 30);
                DrawCardBox(g, toastRect, Color.FromArgb(16, 48, 28), Color.FromArgb(74, 222, 128));
                DrawClippedText(g, receivedBannerText, 8.25f, FontStyle.Bold, Color.FromArgb(74, 222, 128), new Rectangle(18, y + 7, w - 16, 18));
                y += 38;
            }

            // Section A: Active Incoming Transfers
            if (activeItems.Count > 0) {
                y = DrawSectionHeader(g, "ACTIVE TRANSFERS", 10, y);
                for (int i = 0; i < activeItems.Count && y < feedCanvasPanel.Height - 40; i++) {
                    ActiveTransferItem item = activeItems[i];
                    Rectangle rowRect = new Rectangle(10, y, w, 54);
                    DrawCardBox(g, rowRect, Color.FromArgb(26, 26, 34), Color.FromArgb(52, 52, 64));

                    string tag = GetFileCategoryTag(item.FileName);
                    string title = item.TotalFiles > 1
                        ? string.Format("[{0}] [{1}/{2}] {3}", tag, item.QueueIndex, item.TotalFiles, item.FileName)
                        : string.Format("[{0}] {1}", tag, item.FileName);
                    DrawClippedText(g, title, 9f, FontStyle.Bold, Color.FromArgb(250, 250, 250), new Rectangle(20, y + 6, w - 88, 18));

                    string speedTxt = item.SpeedBps > 0
                        ? string.Format("{0:0.0} MB/s", item.SpeedBps / (1024.0 * 1024.0))
                        : string.Format("{0}%", item.Percent);
                    DrawRightText(g, speedTxt, 8.25f, FontStyle.Bold, Color.FromArgb(74, 222, 128), new Rectangle(20, y + 6, w - 20, 18));

                    // Rounded Progress Capsule
                    Rectangle track = new Rectangle(20, y + 29, w - 20, 6);
                    using (GraphicsPath trackPath = GlassDraw.CreateRoundedRectPath(track, 3f))
                    using (SolidBrush tb = new SolidBrush(Color.FromArgb(40, 40, 50))) {
                        g.FillPath(tb, trackPath);
                    }
                    int fillW = Math.Max(6, (int)(track.Width * (Math.Min(100, Math.Max(0, item.Percent)) / 100.0)));
                    Rectangle fillRect = new Rectangle(track.X, track.Y, Math.Min(track.Width, fillW), track.Height);
                    using (GraphicsPath fillPath = GlassDraw.CreateRoundedRectPath(fillRect, 3f))
                    using (SolidBrush fb = new SolidBrush(Color.FromArgb(250, 250, 250))) {
                        g.FillPath(fb, fillPath);
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
                    DrawCardBox(g, rowRect, Color.FromArgb(22, 22, 28), Color.FromArgb(44, 44, 56));

                    string obLabel = string.Format("[{0}] {1}", GetFileCategoryTag(ob.Name), ob.Name);
                    DrawClippedText(g, obLabel, 8.5f, FontStyle.Bold, Color.FromArgb(244, 244, 245), new Rectangle(18, y + 8, w - 96, 18));
                    DrawRightText(g, FormatBytes(ob.Size), 7.75f, FontStyle.Regular, Color.FromArgb(161, 161, 170), new Rectangle(18, y + 9, w - 52, 16));

                    Rectangle unshareBtn = new Rectangle(10 + w - 30, y + 6, 22, 22);
                    int idx = feedHits.Count;
                    feedHits.Add(new FeedHitRegion { Bounds = unshareBtn, Kind = "unshare", Payload = ob.Id });
                    bool isHov = hoveredHitIndex == idx;
                    bool isFoc = feedCanvasPanel.Focused && focusedHitIndex == idx;
                    DrawActionPill(g, unshareBtn, "X",
                        isHov ? Color.FromArgb(62, 42, 46) : Color.FromArgb(36, 36, 46),
                        isHov ? Color.FromArgb(250, 250, 250) : Color.FromArgb(212, 212, 216),
                        isFoc);

                    y += 39;
                }
            }

            // Section C: Recent Completed / Cancelled Transfers
            if (completedItems.Count > 0 && y < feedCanvasPanel.Height - 36) {
                y = DrawSectionHeader(g, "RECEIVED IN DOWNLOADS\\UDROP", 10, y);
                for (int i = 0; i < completedItems.Count && y < feedCanvasPanel.Height - 32; i++) {
                    CompletedTransferItem ct = completedItems[i];
                    Rectangle rowRect = new Rectangle(10, y, w, 36);
                    DrawCardBox(g, rowRect, Color.FromArgb(22, 22, 28), Color.FromArgb(44, 44, 56));

                    bool cancelled = ct.Status == "cancelled";
                    Color pillCol = cancelled ? Color.FromArgb(248, 113, 113) : Color.FromArgb(74, 222, 128);
                    string catTag = GetFileCategoryTag(ct.FileName);
                    string line = string.Format("[{0}] {1} ({2})", catTag, ct.FileName, FormatBytes(ct.FileSize));
                    DrawClippedText(g, line, 8.25f, FontStyle.Bold, cancelled ? Color.FromArgb(161, 161, 170) : Color.FromArgb(244, 244, 245), new Rectangle(18, y + 9, w - 122, 18));

                    if (!cancelled && !string.IsNullOrEmpty(ct.FilePath)) {
                        string verb = GetContextActionVerb(catTag);
                        Rectangle openBtn = new Rectangle(10 + w - 102, y + 7, 54, 22);
                        int launchIdx = feedHits.Count;
                        feedHits.Add(new FeedHitRegion { Bounds = openBtn, Kind = "launch", Payload = ct.FilePath });
                        DrawActionPill(g, openBtn, verb,
                            hoveredHitIndex == launchIdx ? Color.FromArgb(228, 228, 231) : Color.FromArgb(250, 250, 250),
                            Color.FromArgb(9, 9, 11),
                            feedCanvasPanel.Focused && focusedHitIndex == launchIdx);

                        Rectangle dirBtn = new Rectangle(10 + w - 42, y + 7, 34, 22);
                        int dirIdx = feedHits.Count;
                        feedHits.Add(new FeedHitRegion { Bounds = dirBtn, Kind = "open", Payload = ct.FilePath });
                        DrawActionPill(g, dirBtn, "Dir",
                            hoveredHitIndex == dirIdx ? Color.FromArgb(52, 52, 66) : Color.FromArgb(36, 36, 46),
                            Color.FromArgb(244, 244, 245),
                            feedCanvasPanel.Focused && focusedHitIndex == dirIdx);
                    } else {
                        DrawRightText(g, cancelled ? "Cancelled" : "Done", 7.75f, FontStyle.Bold, pillCol, new Rectangle(18, y + 10, w - 18, 16));
                    }

                    y += 41;
                }
            }

            if (activeItems.Count == 0 && outboundItems.Count == 0 && completedItems.Count == 0) {
                using (Font f = new Font("Segoe UI", 9f, FontStyle.Regular))
                using (SolidBrush b = new SolidBrush(Color.FromArgb(161, 161, 170))) {
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
            using (SolidBrush b = new SolidBrush(Color.FromArgb(161, 161, 170))) {
                g.DrawString(text, f, b, x, y);
            }
            return y + 16;
        }

        private static void DrawCardBox(Graphics g, Rectangle rect, Color fill, Color border) {
            using (GraphicsPath path = GlassDraw.CreateRoundedRectPath(rect, 10f))
            using (SolidBrush fb = new SolidBrush(fill))
            using (Pen bp = new Pen(border, 1f)) {
                g.FillPath(fb, path);
                g.DrawPath(bp, path);
            }
        }

        private static void DrawActionPill(Graphics g, Rectangle rect, string text, Color fill, Color fg, bool focused) {
            using (GraphicsPath path = GlassDraw.CreateRoundedRectPath(rect, 7f))
            using (SolidBrush fb = new SolidBrush(fill))
            using (Font f = new Font("Segoe UI", 7.5f, FontStyle.Bold))
            using (SolidBrush tb = new SolidBrush(fg)) {
                g.FillPath(fb, path);
                if (focused) {
                    using (Pen fp = new Pen(Color.FromArgb(250, 250, 250), 1.4f)) {
                        g.DrawPath(fp, path);
                    }
                }
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
            int nextHover = -1;
            for (int i = 0; i < feedHits.Count; i++) {
                if (feedHits[i].Bounds.Contains(e.Location)) {
                    nextHover = i;
                    break;
                }
            }
            if (nextHover != hoveredHitIndex) {
                hoveredHitIndex = nextHover;
                feedCanvasPanel.Invalidate();
            }
            feedCanvasPanel.Cursor = nextHover >= 0 ? Cursors.Hand : Cursors.Default;
        }

        private void OnFeedCanvasClick(object sender, MouseEventArgs e) {
            for (int i = 0; i < feedHits.Count; i++) {
                if (!feedHits[i].Bounds.Contains(e.Location)) continue;
                focusedHitIndex = i;
                TriggerFeedHit(feedHits[i]);
                break;
            }
        }

        private void OnFeedCanvasKeyDown(object sender, KeyEventArgs e) {
            if (feedHits.Count == 0) return;
            if (e.KeyCode == Keys.Down || e.KeyCode == Keys.Right) {
                focusedHitIndex = (focusedHitIndex + 1) % feedHits.Count;
                feedCanvasPanel.Invalidate();
                e.Handled = true;
            } else if (e.KeyCode == Keys.Up || e.KeyCode == Keys.Left) {
                focusedHitIndex = (focusedHitIndex <= 0 ? feedHits.Count - 1 : focusedHitIndex - 1);
                feedCanvasPanel.Invalidate();
                e.Handled = true;
            } else if ((e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) && focusedHitIndex >= 0 && focusedHitIndex < feedHits.Count) {
                TriggerFeedHit(feedHits[focusedHitIndex]);
                e.Handled = true;
            }
        }

        private void TriggerFeedHit(FeedHitRegion hit) {
            if (hit == null) return;
            if (hit.Kind == "launch") {
                OpenFileWithDefaultApp(hit.Payload);
            } else if (hit.Kind == "open") {
                RevealFileInExplorer(hit.Payload);
            } else if (hit.Kind == "unshare") {
                UnshareOutboundFile(hit.Payload);
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

        private static string GetFileCategoryTag(string fileName) {
            string ext = (Path.GetExtension(fileName ?? "") ?? "").ToLowerInvariant();
            if (ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp" || ext == ".gif" || ext == ".heic" || ext == ".heif" || ext == ".bmp" || ext == ".avif") return "PHOTO";
            if (ext == ".mp4" || ext == ".m4v" || ext == ".mov" || ext == ".webm" || ext == ".mkv") return "VIDEO";
            if (ext == ".vcf" || ext == ".vcard") return "CONTACT";
            if (ext == ".pdf") return "PDF";
            if (ext == ".mp3" || ext == ".m4a" || ext == ".wav" || ext == ".aac" || ext == ".ogg" || ext == ".flac") return "AUDIO";
            if (ext == ".zip" || ext == ".rar" || ext == ".7z" || ext == ".tar" || ext == ".gz") return "ZIP";
            return "FILE";
        }

        private static string GetContextActionVerb(string tag) {
            if (tag == "PHOTO" || tag == "PDF") return "View";
            if (tag == "VIDEO" || tag == "AUDIO") return "Play";
            if (tag == "CONTACT") return "Import";
            return "Open";
        }

        private void OpenFileWithDefaultApp(string filePath) {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return;
            try {
                Process.Start(new ProcessStartInfo {
                    FileName = filePath,
                    UseShellExecute = true
                });
            } catch {
                RevealFileInExplorer(filePath);
            }
        }

        private void RevealFileInExplorer(string filePath) {
            if (string.IsNullOrEmpty(filePath)) return;
            EngineHelper.RevealInExplorerAndFocus(filePath, File.Exists(filePath));
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

        private void OnFormPaint(object sender, PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle outerRect = new Rectangle(1, 1, this.Width - 3, this.Height - 3);
            GlassDraw.DrawLiquidGlassRim(g, outerRect, 14f, true);
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

    /// <summary>
    /// Modern iOS-style floating Liquid Glass push banner shown when files arrive.
    /// </summary>
    public class IosNotificationForm : Form {
        [StructLayout(LayoutKind.Sequential)]
        private struct MARGINS {
            public int cxLeftWidth;
            public int cxRightWidth;
            public int cyTopHeight;
            public int cyBottomHeight;
        }

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

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);

        [DllImport("user32.dll")]
        private static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        private string bannerTitle = "File Received";
        private string bannerFile = "";
        private string bannerMeta = "";
        private string bannerFilePath = "";
        private readonly Action onOpenFolderFallback;
        private Rectangle openBtnRect;
        private Rectangle closeBtnRect;
        private bool hoverOpen = false;
        private bool hoverClose = false;
        private System.Windows.Forms.Timer autoHideTimer;

        protected override bool ShowWithoutActivation {
            get { return true; }
        }

        protected override CreateParams CreateParams {
            get {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
                cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
                return cp;
            }
        }

        public IosNotificationForm(Action openFolderCallback) {
            this.onOpenFolderFallback = openFolderCallback;
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.Size = new Size(388, 78);
            this.BackColor = Color.Black;
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.DoubleBuffered = true;
            this.Cursor = Cursors.Hand;

            this.MouseMove += (s, e) => {
                bool nextOpen = openBtnRect.Contains(e.Location);
                bool nextClose = closeBtnRect.Contains(e.Location);
                if (nextOpen != hoverOpen || nextClose != hoverClose) {
                    hoverOpen = nextOpen;
                    hoverClose = nextClose;
                    this.Invalidate();
                }
            };
            this.MouseLeave += (s, e) => {
                if (hoverOpen || hoverClose) {
                    hoverOpen = false;
                    hoverClose = false;
                    this.Invalidate();
                }
            };
            this.MouseClick += (s, e) => {
                if (closeBtnRect.Contains(e.Location)) {
                    DismissBanner();
                    return;
                }
                OpenReceivedTarget();
                DismissBanner();
            };

            autoHideTimer = new System.Windows.Forms.Timer { Interval = 5500 };
            autoHideTimer.Tick += (s, e) => DismissBanner();
        }

        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
            try {
                int dark = 1;
                DwmSetWindowAttribute(this.Handle, 20, ref dark, sizeof(int));
                int pref = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(this.Handle, 33, ref pref, sizeof(int));
                MARGINS m = new MARGINS { cxLeftWidth = -1, cxRightWidth = -1, cyTopHeight = -1, cyBottomHeight = -1 };
                DwmExtendFrameIntoClientArea(this.Handle, ref m);
                int backdrop = 3; // DWMSBT_TRANSIENTWINDOW
                if (DwmSetWindowAttribute(this.Handle, 38, ref backdrop, sizeof(int)) == 0) return;
            } catch {}

            try {
                AccentPolicy accent = new AccentPolicy {
                    AccentState = 4,
                    AccentFlags = 2,
                    GradientColor = unchecked((int)0xB0141418),
                    AnimationId = 0
                };
                int size = Marshal.SizeOf(accent);
                IntPtr ptr = Marshal.AllocHGlobal(size);
                try {
                    Marshal.StructureToPtr(accent, ptr, false);
                    WindowCompositionAttributeData data = new WindowCompositionAttributeData {
                        Attribute = 19,
                        Data = ptr,
                        SizeOfData = size
                    };
                    SetWindowCompositionAttribute(this.Handle, ref data);
                } finally {
                    Marshal.FreeHGlobal(ptr);
                }
            } catch {}
        }

        public void ShowNotification(string title, string fileName, string metaText, string filePath) {
            bannerTitle = string.IsNullOrEmpty(title) ? "File Received" : title;
            bannerFile = fileName ?? "";
            bannerMeta = metaText ?? "";
            bannerFilePath = filePath ?? "";

            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            this.Location = new Point(wa.Left + (wa.Width - this.Width) / 2, wa.Top + 14);

            autoHideTimer.Stop();
            autoHideTimer.Start();

            if (!this.Visible) {
                this.Show();
            }
            this.Invalidate();
        }

        public void DismissBanner() {
            if (autoHideTimer != null) autoHideTimer.Stop();
            if (this.Visible) this.Hide();
        }

        private void OpenReceivedTarget() {
            if (!string.IsNullOrEmpty(bannerFilePath)) {
                EngineHelper.RevealInExplorerAndFocus(bannerFilePath, File.Exists(bannerFilePath));
                return;
            }
            if (onOpenFolderFallback != null) onOpenFolderFallback();
        }

        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            g.Clear(Color.Black);

            Rectangle outer = new Rectangle(1, 1, this.Width - 3, this.Height - 3);
            GlassDraw.DrawLiquidGlassCard(g, outer, 20f, false);
            GlassDraw.DrawLiquidGlassRim(g, outer, 20f, true);

            // Left iOS App Icon Squircle [ U ] + green dot
            Rectangle iconRect = new Rectangle(14, 17, 42, 42);
            using (GraphicsPath ip = GlassDraw.CreateRoundedRectPath(iconRect, 12f))
            using (SolidBrush ib = new SolidBrush(Color.FromArgb(44, 255, 255, 255)))
            using (Pen ipen = new Pen(Color.FromArgb(90, 255, 255, 255), 1f)) {
                g.FillPath(ib, ip);
                g.DrawPath(ipen, ip);
            }
            using (Font uf = new Font("Consolas", 9.5f, FontStyle.Bold))
            using (SolidBrush ub = new SolidBrush(Color.FromArgb(250, 250, 250))) {
                StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString("[U]", uf, ub, iconRect, sf);
            }
            using (SolidBrush db = new SolidBrush(Color.FromArgb(34, 197, 94))) {
                g.FillEllipse(db, iconRect.Right - 9, iconRect.Bottom - 9, 10, 10);
            }

            // Right iOS action pills ("Open" + "x")
            closeBtnRect = new Rectangle(this.Width - 38, 26, 24, 24);
            openBtnRect = new Rectangle(this.Width - 94, 25, 48, 26);

            using (GraphicsPath op = GlassDraw.CreateRoundedRectPath(openBtnRect, 13f))
            using (SolidBrush ob = new SolidBrush(hoverOpen ? Color.FromArgb(228, 228, 231) : Color.FromArgb(250, 250, 250))) {
                g.FillPath(ob, op);
            }
            using (Font bf = new Font("Segoe UI", 8f, FontStyle.Bold))
            using (SolidBrush btb = new SolidBrush(Color.FromArgb(9, 9, 11))) {
                StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString("Open", bf, btb, openBtnRect, sf);
            }

            using (GraphicsPath cp = GlassDraw.CreateRoundedRectPath(closeBtnRect, 12f))
            using (SolidBrush cb = new SolidBrush(hoverClose ? Color.FromArgb(65, 255, 255, 255) : Color.FromArgb(32, 255, 255, 255))) {
                g.FillPath(cb, cp);
            }
            using (Pen xpen = new Pen(Color.FromArgb(228, 228, 231), 1.6f)) {
                xpen.StartCap = LineCap.Round;
                xpen.EndCap = LineCap.Round;
                int cx = closeBtnRect.X + closeBtnRect.Width / 2;
                int cy = closeBtnRect.Y + closeBtnRect.Height / 2;
                g.DrawLine(xpen, cx - 4, cy - 4, cx + 4, cy + 4);
                g.DrawLine(xpen, cx + 4, cy - 4, cx - 4, cy + 4);
            }

            // Text content (header row with "now", bold filename, muted meta)
            int textX = 66;
            int textW = openBtnRect.Left - textX - 10;
            StringFormat clipFmt = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };

            using (Font tf = new Font("Segoe UI", 8.25f, FontStyle.Bold))
            using (SolidBrush tb = new SolidBrush(Color.FromArgb(74, 222, 128))) {
                g.DrawString(bannerTitle, tf, tb, new RectangleF(textX, 13, textW - 32, 16), clipFmt);
            }
            using (Font nowf = new Font("Segoe UI", 7.75f, FontStyle.Regular))
            using (SolidBrush nowb = new SolidBrush(Color.FromArgb(161, 161, 170))) {
                StringFormat rf = new StringFormat { Alignment = StringAlignment.Far, FormatFlags = StringFormatFlags.NoWrap };
                g.DrawString("now", nowf, nowb, new RectangleF(textX, 13, textW, 16), rf);
            }
            using (Font ff = new Font("Segoe UI", 9.25f, FontStyle.Bold))
            using (SolidBrush fb = new SolidBrush(Color.FromArgb(250, 250, 250))) {
                g.DrawString(bannerFile, ff, fb, new RectangleF(textX, 31, textW, 18), clipFmt);
            }
            using (Font mf = new Font("Segoe UI", 7.75f, FontStyle.Regular))
            using (SolidBrush mb = new SolidBrush(Color.FromArgb(196, 196, 206))) {
                g.DrawString(bannerMeta, mf, mb, new RectangleF(textX, 50, textW, 16), clipFmt);
            }
        }
    }
}
