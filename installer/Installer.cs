using System;
using System.IO;
using System.IO.Compression;
using System.Drawing;
using System.Reflection;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Win32;

namespace UDropInstaller {
    static class Program {
        [STAThread]
        static void Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }

    public class InstallerForm : Form {
        // UI Controls
        private Panel headerPanel;
        private Label lblHeaderTitle;
        private Label lblHeaderSubtitle;

        // Step 1: Config Panel
        private Panel configPanel;
        private Label lblLocationTitle;
        private Label lblLocationDesc;
        private TextBox txtInstallPath;
        private Button btnBrowse;
        private Label lblOptionsTitle;
        private CheckBox chkStartup;
        private CheckBox chkDesktop;
        private CheckBox chkStartMenu;
        private CheckBox chkContextMenu;
        private CheckBox chkLaunchAfter;

        // Step 2: Progress Panel
        private Panel progressPanel;
        private Label lblProgressTitle;
        private Label lblProgressDetail;
        private ProgressBar progressBar;
        private ListBox lstLog;

        // Bottom Action Bar
        private Panel bottomPanel;
        private Panel separatorLine;
        private Button btnActionPrimary;
        private Button btnActionSecondary;
        private Button btnOpenFolder;

        // State
        private bool isInstalling = false;
        private bool isFinished = false;
        private string finalInstallPath = "";

        public InstallerForm() {
            InitializeComponent();
        }

        private void InitializeComponent() {
            this.Text = "uDrop Setup Wizard";
            this.Size = new Size(580, 520);
            this.MinimumSize = new Size(580, 520);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(14, 14, 18);
            this.ForeColor = Color.FromArgb(250, 250, 250);
            this.Font = new Font("Segoe UI", 9.25f, FontStyle.Regular);

            // 1. Header Panel
            headerPanel = new Panel {
                Dock = DockStyle.Top,
                Height = 72,
                BackColor = Color.FromArgb(20, 20, 25),
                Padding = new Padding(24, 14, 24, 10)
            };

            lblHeaderTitle = new Label {
                Text = "uDrop Setup",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                AutoSize = true,
                Location = new Point(22, 12)
            };

            lblHeaderSubtitle = new Label {
                Text = "UXIOM MESH - Zero-Router Peer-to-Peer File Transfer",
                Font = new Font("Segoe UI", 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                AutoSize = true,
                Location = new Point(23, 39)
            };

            headerPanel.Controls.Add(lblHeaderTitle);
            headerPanel.Controls.Add(lblHeaderSubtitle);

            // 2. Bottom Panel
            bottomPanel = new Panel {
                Dock = DockStyle.Bottom,
                Height = 62,
                BackColor = Color.FromArgb(18, 18, 22)
            };

            separatorLine = new Panel {
                Dock = DockStyle.Top,
                Height = 1,
                BackColor = Color.FromArgb(40, 40, 48)
            };
            bottomPanel.Controls.Add(separatorLine);

            btnOpenFolder = new Button {
                Text = "Open Folder",
                Size = new Size(100, 32),
                Location = new Point(24, 16),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(28, 28, 34),
                ForeColor = Color.FromArgb(200, 200, 210),
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                Visible = false,
                Cursor = Cursors.Hand
            };
            btnOpenFolder.FlatAppearance.BorderColor = Color.FromArgb(50, 50, 60);
            btnOpenFolder.Click += (s, e) => {
                if (Directory.Exists(finalInstallPath)) {
                    Process.Start("explorer.exe", finalInstallPath);
                }
            };
            bottomPanel.Controls.Add(btnOpenFolder);

            btnActionSecondary = new Button {
                Text = "Cancel",
                Size = new Size(88, 32),
                Location = new Point(366, 16),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(28, 28, 34),
                ForeColor = Color.FromArgb(200, 200, 210),
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                Cursor = Cursors.Hand
            };
            btnActionSecondary.FlatAppearance.BorderColor = Color.FromArgb(50, 50, 60);
            btnActionSecondary.Click += (s, e) => this.Close();
            bottomPanel.Controls.Add(btnActionSecondary);

            btnActionPrimary = new Button {
                Text = "Install",
                Size = new Size(92, 32),
                Location = new Point(462, 16),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(250, 250, 250),
                ForeColor = Color.FromArgb(10, 10, 12),
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnActionPrimary.FlatAppearance.BorderColor = Color.FromArgb(250, 250, 250);
            btnActionPrimary.Click += BtnActionPrimary_Click;
            bottomPanel.Controls.Add(btnActionPrimary);

            // 3. Step 1: Config Panel
            configPanel = new Panel {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(14, 14, 18),
                Padding = new Padding(24, 18, 24, 18)
            };

            lblLocationTitle = new Label {
                Text = "Install Location",
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                AutoSize = true,
                Location = new Point(22, 16)
            };

            lblLocationDesc = new Label {
                Text = "Choose the directory where uDrop and its local runtime will be installed:",
                Font = new Font("Segoe UI", 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                AutoSize = true,
                Location = new Point(23, 38)
            };

            string defaultPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "uDrop");
            txtInstallPath = new TextBox {
                Text = defaultPath,
                Location = new Point(24, 62),
                Size = new Size(418, 26),
                BackColor = Color.FromArgb(24, 24, 28),
                ForeColor = Color.FromArgb(250, 250, 250),
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Segoe UI", 9.25f, FontStyle.Regular)
            };

            btnBrowse = new Button {
                Text = "Browse...",
                Location = new Point(450, 60),
                Size = new Size(88, 28),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(32, 32, 38),
                ForeColor = Color.FromArgb(250, 250, 250),
                Font = new Font("Segoe UI", 8.75f, FontStyle.Regular),
                Cursor = Cursors.Hand
            };
            btnBrowse.FlatAppearance.BorderColor = Color.FromArgb(60, 60, 72);
            btnBrowse.Click += (s, e) => {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {
                    fbd.Description = "Select target installation directory for uDrop";
                    fbd.SelectedPath = Directory.Exists(txtInstallPath.Text) ? txtInstallPath.Text : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    if (fbd.ShowDialog(this) == DialogResult.OK && !string.IsNullOrWhiteSpace(fbd.SelectedPath)) {
                        string chosen = fbd.SelectedPath;
                        if (!chosen.EndsWith("uDrop", StringComparison.OrdinalIgnoreCase)) {
                            chosen = Path.Combine(chosen, "uDrop");
                        }
                        txtInstallPath.Text = chosen;
                    }
                }
            };

            lblOptionsTitle = new Label {
                Text = "Setup Options",
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                AutoSize = true,
                Location = new Point(22, 114)
            };

            chkStartup = new CheckBox {
                Text = "Add uDrop tray toggle to Windows startup (starts OFF until clicked)",
                Location = new Point(25, 140),
                Size = new Size(510, 24),
                Checked = true,
                ForeColor = Color.FromArgb(220, 220, 225)
            };

            chkDesktop = new CheckBox {
                Text = "Create a Desktop shortcut",
                Location = new Point(25, 168),
                Size = new Size(510, 24),
                Checked = true,
                ForeColor = Color.FromArgb(220, 220, 225)
            };

            chkStartMenu = new CheckBox {
                Text = "Create a Start Menu shortcut",
                Location = new Point(25, 196),
                Size = new Size(510, 24),
                Checked = true,
                ForeColor = Color.FromArgb(220, 220, 225)
            };

            chkContextMenu = new CheckBox {
                Text = "Add 'Share via uDrop' to Windows Explorer right-click menu",
                Location = new Point(25, 224),
                Size = new Size(510, 24),
                Checked = true,
                ForeColor = Color.FromArgb(220, 220, 225)
            };

            chkLaunchAfter = new CheckBox {
                Text = "Start uDrop System Tray icon right after installation completes",
                Location = new Point(25, 252),
                Size = new Size(510, 24),
                Checked = true,
                ForeColor = Color.FromArgb(220, 220, 225)
            };

            configPanel.Controls.Add(lblLocationTitle);
            configPanel.Controls.Add(lblLocationDesc);
            configPanel.Controls.Add(txtInstallPath);
            configPanel.Controls.Add(btnBrowse);
            configPanel.Controls.Add(lblOptionsTitle);
            configPanel.Controls.Add(chkStartup);
            configPanel.Controls.Add(chkDesktop);
            configPanel.Controls.Add(chkStartMenu);
            configPanel.Controls.Add(chkContextMenu);
            configPanel.Controls.Add(chkLaunchAfter);

            // 4. Step 2: Progress Panel (Hidden initially)
            progressPanel = new Panel {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(14, 14, 18),
                Padding = new Padding(24, 18, 24, 18),
                Visible = false
            };

            lblProgressTitle = new Label {
                Text = "Installing uDrop...",
                Font = new Font("Segoe UI", 11.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(250, 250, 250),
                AutoSize = true,
                Location = new Point(22, 14)
            };

            lblProgressDetail = new Label {
                Text = "Preparing distribution assets...",
                Font = new Font("Segoe UI", 8.75f, FontStyle.Regular),
                ForeColor = Color.FromArgb(161, 161, 170),
                AutoSize = true,
                Location = new Point(23, 38)
            };

            progressBar = new ProgressBar {
                Location = new Point(24, 62),
                Size = new Size(514, 14),
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Style = ProgressBarStyle.Continuous
            };

            lstLog = new ListBox {
                Location = new Point(24, 88),
                Size = new Size(514, 210),
                BackColor = Color.FromArgb(20, 20, 25),
                ForeColor = Color.FromArgb(170, 170, 180),
                Font = new Font("Consolas", 8.75f, FontStyle.Regular),
                BorderStyle = BorderStyle.FixedSingle,
                IntegralHeight = false
            };

            progressPanel.Controls.Add(lblProgressTitle);
            progressPanel.Controls.Add(lblProgressDetail);
            progressPanel.Controls.Add(progressBar);
            progressPanel.Controls.Add(lstLog);

            // Add panels to Form
            this.Controls.Add(configPanel);
            this.Controls.Add(progressPanel);
            this.Controls.Add(bottomPanel);
            this.Controls.Add(headerPanel);
        }

        private void BtnActionPrimary_Click(object sender, EventArgs e) {
            if (isFinished) {
                this.Close();
                return;
            }

            if (isInstalling) return;

            string targetDir = txtInstallPath.Text.Trim();
            if (string.IsNullOrWhiteSpace(targetDir)) {
                MessageBox.Show(this, "Please select or enter a valid installation directory.", "Invalid Path", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            // Transition from Config to Progress View
            configPanel.Visible = false;
            progressPanel.Visible = true;
            isInstalling = true;

            btnActionPrimary.Enabled = false;
            btnActionPrimary.Text = "Installing...";
            btnActionSecondary.Enabled = false;

            finalInstallPath = targetDir;

            // Run installation asynchronously
            Thread installThread = new Thread(() => ExecuteInstallation(targetDir));
            installThread.IsBackground = true;
            installThread.Start();
        }

        private void Log(string message, int progressPercent, string detailText) {
            if (this.InvokeRequired) {
                this.BeginInvoke(new Action(() => Log(message, progressPercent, detailText)));
                return;
            }

            if (!string.IsNullOrEmpty(message)) {
                lstLog.Items.Add(message);
                lstLog.TopIndex = lstLog.Items.Count - 1;
            }

            if (progressPercent >= 0 && progressPercent <= 100) {
                progressBar.Value = progressPercent;
            }

            if (!string.IsNullOrEmpty(detailText)) {
                lblProgressDetail.Text = detailText;
            }
        }

        private void ExecuteInstallation(string targetDir) {
            try {
                Log("[*] Starting uDrop installation sequence...", 5, "Validating source files...");
                Thread.Sleep(150);

                // Create destination directory
                if (!Directory.Exists(targetDir)) {
                    Directory.CreateDirectory(targetDir);
                    Log(string.Format("[OK] Created directory: {0}", targetDir), 15, "Preparing target folder...");
                } else {
                    Log(string.Format("[OK] Destination directory ready: {0}", targetDir), 15, "Preparing target folder...");
                }

                string dstLauncher = Path.Combine(targetDir, "udrop.exe");
                if (File.Exists(dstLauncher)) {
                    Log("[*] Stopping any running uDrop instances in destination...", 18, "Stopping running instances...");
                    try {
                        Process stopProc = Process.Start(new ProcessStartInfo {
                            FileName = dstLauncher,
                            Arguments = "--stop",
                            CreateNoWindow = true,
                            UseShellExecute = false
                        });
                        if (stopProc != null) stopProc.WaitForExit(1500);
                    } catch {}
                    try {
                        foreach (Process p in Process.GetProcessesByName("udrop")) {
                            try { p.Kill(); } catch {}
                        }
                    } catch {}
                    Thread.Sleep(250);
                }

                // Prefer standalone embedded ZIP resource if built in self-contained mode
                Stream payloadStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("uDropPayload.zip");
                if (payloadStream != null) {
                    Log("[OK] Standalone compressed payload found inside installer.", 22, "Extracting embedded runtime...");
                    using (payloadStream)
                    using (ZipArchive archive = new ZipArchive(payloadStream, ZipArchiveMode.Read)) {
                        int totalEntries = Math.Max(1, archive.Entries.Count);
                        int doneEntries = 0;
                        string fullTargetRoot = Path.GetFullPath(targetDir);
                        if (!fullTargetRoot.EndsWith(Path.DirectorySeparatorChar.ToString())) {
                            fullTargetRoot += Path.DirectorySeparatorChar;
                        }

                        foreach (ZipArchiveEntry entry in archive.Entries) {
                            string destFile = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                            if (!destFile.StartsWith(fullTargetRoot, StringComparison.OrdinalIgnoreCase)) {
                                continue;
                            }
                            if (string.IsNullOrEmpty(entry.Name)) {
                                if (!Directory.Exists(destFile)) Directory.CreateDirectory(destFile);
                                continue;
                            }
                            string parentDir = Path.GetDirectoryName(destFile);
                            if (!string.IsNullOrEmpty(parentDir) && !Directory.Exists(parentDir)) {
                                Directory.CreateDirectory(parentDir);
                            }

                            int pct = 25 + (int)Math.Round((doneEntries / (double)totalEntries) * 55.0);
                            Log(string.Format("[+] Extracting {0}...", entry.Name), pct, string.Format("Extracting {0}...", entry.Name));
                            using (Stream inStream = entry.Open())
                            using (FileStream outStream = new FileStream(destFile, FileMode.Create, FileAccess.Write, FileShare.None)) {
                                inStream.CopyTo(outStream);
                            }
                            doneEntries++;
                        }
                    }
                    Log("[OK] All embedded runtime binaries extracted cleanly.", 80, "Configuring Windows system integration...");
                } else {
                    // Fallback: copy adjacent dist/ files for local development builds
                    string sourceDir = AppDomain.CurrentDomain.BaseDirectory;
                    string distDir = Directory.Exists(Path.Combine(sourceDir, "dist")) ? Path.Combine(sourceDir, "dist") : sourceDir;
                    if (!File.Exists(Path.Combine(distDir, "udrop.exe")) && Directory.Exists(Path.Combine(sourceDir, "..", "dist"))) {
                        distDir = Path.Combine(sourceDir, "..", "dist");
                    }

                    Log(string.Format("[OK] Source package located: {0}", distDir), 25, "Copying runtime binaries...");

                    string srcNode = Path.Combine(distDir, "node.exe");
                    string dstNode = Path.Combine(targetDir, "node.exe");
                    if (File.Exists(srcNode)) {
                        Log("[+] Copying portable runtime engine (node.exe)...", 35, "Copying node.exe...");
                        File.Copy(srcNode, dstNode, true);
                        Log("[OK] node.exe deployed successfully.", 50, "Copying application bundle...");
                    }

                    string srcBundle = Path.Combine(distDir, "bundle.cjs");
                    string dstBundle = Path.Combine(targetDir, "bundle.cjs");
                    if (File.Exists(srcBundle)) {
                        Log("[+] Deploying core application bundle (bundle.cjs)...", 60, "Copying bundle.cjs...");
                        File.Copy(srcBundle, dstBundle, true);
                        Log("[OK] bundle.cjs deployed successfully.", 70, "Installing tray controller...");
                    } else {
                        Log("[FAIL] bundle.cjs missing from source package.", 70, "Error encountered.");
                        throw new FileNotFoundException("Required file 'bundle.cjs' not found in distribution folder.");
                    }

                    string srcLauncher = Path.Combine(distDir, "udrop.exe");
                    if (File.Exists(srcLauncher)) {
                        Log("[+] Deploying uDrop tray controller (udrop.exe)...", 75, "Copying udrop.exe...");
                        File.Copy(srcLauncher, dstLauncher, true);
                        Log("[OK] udrop.exe deployed successfully.", 78, "Copying uninstaller...");
                    }

                    string srcUninstall = Path.Combine(distDir, "uninstall.bat");
                    string dstUninstall = Path.Combine(targetDir, "uninstall.bat");
                    if (File.Exists(srcUninstall)) {
                        File.Copy(srcUninstall, dstUninstall, true);
                    }
                    Log("[OK] Runtime files copied.", 80, "Configuring Windows system integration...");
                }
                Thread.Sleep(150);

                // Windows Startup Registry (--tray starts OFF by default)
                if (chkStartup.Checked) {
                    Log("[+] Registering system tray startup (OFF by default) in HKCU\\Run...", 84, "Configuring startup...");
                    using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) {
                        if (key != null) {
                            key.SetValue("uDrop", "\"" + dstLauncher + "\" --tray");
                            Log("[OK] Windows startup tray registration enabled.", 87, "Configuring Explorer integration...");
                        }
                    }
                }

                // Windows Explorer Right-Click Context Menu
                if (chkContextMenu.Checked) {
                    Log("[+] Adding 'Share via uDrop' to Windows File Explorer context menu...", 89, "Registering Explorer menu...");
                    using (RegistryKey shellKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\*\shell\uDropShare")) {
                        if (shellKey != null) {
                            shellKey.SetValue("", "Share via uDrop");
                            shellKey.SetValue("Icon", dstLauncher + ",0");
                        }
                    }
                    using (RegistryKey cmdKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\*\shell\uDropShare\command")) {
                        if (cmdKey != null) {
                            cmdKey.SetValue("", "\"" + dstLauncher + "\" --share \"%1\"");
                        }
                    }
                    Log("[OK] Explorer context menu registered.", 91, "Creating shortcuts...");
                }

                // Register in Windows Settings -> Installed Apps (Per-user HKCU, zero UAC)
                try {
                    string uninstBat = Path.Combine(targetDir, "uninstall.bat");
                    using (RegistryKey uninstKey = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\uDrop")) {
                        if (uninstKey != null) {
                            uninstKey.SetValue("DisplayName", "uDrop");
                            uninstKey.SetValue("DisplayVersion", "1.0.0");
                            uninstKey.SetValue("Publisher", "Uxiom");
                            uninstKey.SetValue("InstallLocation", targetDir);
                            uninstKey.SetValue("DisplayIcon", dstLauncher + ",0");
                            uninstKey.SetValue("UninstallString", "cmd.exe /c \"\"" + uninstBat + "\" /S\"");
                            uninstKey.SetValue("NoModify", 1, RegistryValueKind.DWord);
                            uninstKey.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                        }
                    }
                    Log("[OK] Registered uDrop in Windows Installed Apps.", 92, "Creating shortcuts...");
                } catch {}

                // Desktop Shortcut
                if (chkDesktop.Checked) {
                    string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    string shortcutPath = Path.Combine(desktopDir, "uDrop.lnk");
                    Log(string.Format("[+] Creating Desktop shortcut: {0}...", shortcutPath), 93, "Creating Desktop shortcut...");
                    CreateShortcut(shortcutPath, dstLauncher, "", "uDrop - Instant Cross-Platform P2P File Transfer");
                    Log("[OK] Desktop shortcut created.", 95, "Creating Start Menu shortcut...");
                }

                // Start Menu Shortcut
                if (chkStartMenu.Checked) {
                    string startMenu = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                    string startShortcut = Path.Combine(startMenu, "uDrop.lnk");
                    Log(string.Format("[+] Creating Start Menu shortcut: {0}...", startShortcut), 96, "Creating Start Menu shortcut...");
                    CreateShortcut(startShortcut, dstLauncher, "", "uDrop - Instant Cross-Platform P2P File Transfer");
                    Log("[OK] Start Menu shortcut created.", 98, "Finalizing installation...");
                }

                // Launch Tray Controller (OFF by default until clicked in taskbar)
                if (chkLaunchAfter.Checked) {
                    Log("[+] Starting uDrop System Tray toggle next to clock (OFF by default)...", 99, "Starting uDrop tray...");
                    Process.Start(new ProcessStartInfo {
                        FileName = dstLauncher,
                        Arguments = "--tray",
                        UseShellExecute = true
                    });
                    Log("[OK] uDrop System Tray icon is now live in the taskbar.", 100, "Installation complete!");
                } else {
                    Log("[OK] Setup completed.", 100, "Installation complete!");
                }

                Thread.Sleep(250);
                this.BeginInvoke(new Action(OnInstallationSuccess));

            } catch (Exception ex) {
                Log(string.Format("[ERROR] Installation failed: {0}", ex.Message), -1, "Installation error");
                this.BeginInvoke(new Action(() => OnInstallationFailed(ex.Message)));
            }
        }

        private void OnInstallationSuccess() {
            isInstalling = false;
            isFinished = true;

            lblProgressTitle.Text = "Installation Complete";
            lblProgressDetail.Text = "uDrop has been successfully installed and configured.";
            lblProgressDetail.ForeColor = Color.FromArgb(34, 197, 94); // Status green

            btnActionPrimary.Text = "Finish";
            btnActionPrimary.Enabled = true;
            btnActionPrimary.BackColor = Color.FromArgb(34, 197, 94);
            btnActionPrimary.ForeColor = Color.FromArgb(10, 10, 12);

            btnActionSecondary.Visible = false;
            btnOpenFolder.Visible = true;
        }

        private void OnInstallationFailed(string error) {
            isInstalling = false;
            lblProgressTitle.Text = "Setup Failed";
            lblProgressDetail.Text = error;
            lblProgressDetail.ForeColor = Color.FromArgb(239, 68, 68);

            btnActionPrimary.Text = "Close";
            btnActionPrimary.Enabled = true;
            btnActionSecondary.Visible = false;
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string arguments, string description) {
            try {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.Arguments = arguments;
                shortcut.Description = description;
                shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                shortcut.Save();
            } catch {}
        }
    }
}
