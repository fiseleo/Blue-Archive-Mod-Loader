using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Blue_Archive_Mod_Manager_C_.Models;
using Blue_Archive_Mod_Manager_C_.Utils;
using Blue_Archive_Mod_Manager_C_.Modules;

namespace Blue_Archive_Mod_Manager_C_
{
    public partial class Form1 : Form
    {
        private SettingsManager? _settingsManager;
        private GamePathManager? _gamePathManager;
        private StudentIndexManager? _studentIndexManager;
        private ModManager? _modManager;
        private WebViewBridge? _webBridge;

        public Form1()
        {
            InitializeComponent();
            InitializeModules();
            InitializeWebView();
        }

        private void InitializeModules()
        {
            try
            {
                _settingsManager = new SettingsManager();
                _gamePathManager = new GamePathManager(_settingsManager);
                _studentIndexManager = new StudentIndexManager(_settingsManager);
                _modManager = new ModManager(_settingsManager, _studentIndexManager);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to initialize modules: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.Exit(1);
            }
        }

        private async void InitializeWebView()
        {
            try
            {
                // Initialize WebView2
                await webView21.EnsureCoreWebView2Async();

                // Setup bridge
                _webBridge = new WebViewBridge(webView21);
                RegisterWebViewHandlers();

                // Navigate to the index.html
                var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                var htmlPath = Path.Combine(baseDir, "Web", "index.html");
                
                // Try different paths if standard path doesn't work
                if (!File.Exists(htmlPath))
                {
                    var altPath = Path.Combine(baseDir, "..", "..", "Web", "index.html");
                    if (File.Exists(altPath))
                    {
                        htmlPath = Path.GetFullPath(altPath);
                    }
                }

                if (File.Exists(htmlPath))
                {
                    webView21.Source = new Uri(htmlPath);
                }
                else
                {
                    MessageBox.Show($"index.html not found at:\n{htmlPath}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }

                webView21.ZoomFactor = 1.0;
                webView21.DefaultBackgroundColor = System.Drawing.Color.White;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"WebView2 initialization failed: {ex.Message}\n\nBaseDirectory: {AppDomain.CurrentDomain.BaseDirectory}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void RegisterWebViewHandlers()
        {
            // Game path handlers
            _webBridge.RegisterHandler("getGamePath", async (payload) =>
            {
                var (gamePath, bundlePath) = _gamePathManager.GetGamePaths();
                return new { gamePath, gameBundlePath = bundlePath };
            });

            _webBridge.RegisterHandler("selectGamePath", async (payload) =>
            {
                var result = SelectGamePathDialog();
                if (!string.IsNullOrEmpty(result) && _gamePathManager != null)
                {
                    var paths = _gamePathManager.SaveGamePaths(result);
                    return new { gamePath = paths.gamePath, gameBundlePath = paths.gameBundlePath };
                }
                return null;
            });

            // Mod handlers
            _webBridge.RegisterHandler("getMods", async (payload) =>
            {
                var mods = _modManager.GetAllMods();
                return mods;
            });

            _webBridge.RegisterHandler("selectModFiles", async (payload) =>
            {
                var files = SelectModFilesDialog();
                if (files != null && files.Length > 0)
                {
                    var mods = _modManager.SelectModFiles(files);
                    return new { mods, errors = new List<string>() };
                }
                return null;
            });

            _webBridge.RegisterHandler("updateMod", async (payload) =>
            {
                if (payload.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    var mod = JsonSerializer.Deserialize<ModData>(payload.GetRawText());
                    return _modManager.UpdateMod(mod);
                }
                return null;
            });

            _webBridge.RegisterHandler("deleteMod", async (payload) =>
            {
                var modId = payload.GetString();
                return _modManager.DeleteMod(modId);
            });

            // Action handlers
            _webBridge.RegisterHandler("applyMods", async (payload) =>
            {
                try
                {
                    var selectedIds = JsonSerializer.Deserialize<List<string>>(payload.GetRawText());
                    _modManager.ApplyMods(selectedIds, _gamePathManager);
                    await _webBridge.SendNotificationAsync("statusUpdate", "Mods applied successfully!");
                    return true;
                }
                catch (Exception ex)
                {
                    return new { error = ex.Message };
                }
            });

            _webBridge.RegisterHandler("uninstallMods", async (payload) =>
            {
                try
                {
                    var selectedIds = JsonSerializer.Deserialize<List<string>>(payload.GetRawText());
                    _modManager.UninstallMods(selectedIds, _gamePathManager);
                    await _webBridge.SendNotificationAsync("statusUpdate", "Mods uninstalled successfully!");
                    return true;
                }
                catch (Exception ex)
                {
                    return new { error = ex.Message };
                }
            });

            _webBridge.RegisterHandler("launchGame", async (payload) =>
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "steam://run/3557620",
                        UseShellExecute = true
                    });
                    return true;
                }
                catch (Exception ex)
                {
                    return new { error = ex.Message };
                }
            });
        }

        private string? SelectGamePathDialog()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "Select Blue Archive Executable";
                dialog.Filter = "Executable Files (*.exe)|*.exe|All Files (*.*)|*.*";
                dialog.DefaultExt = "exe";

                if (dialog.ShowDialog() == DialogResult.OK)
                {
                    return dialog.FileName;
                }
            }
            return null;
        }

        private string[]? SelectModFilesDialog()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "Select Mod Files";
                dialog.Filter = "Mod Files (*.ogg;*.mp4;*.jpg;*.jpeg;*.png;*.bundle;*.zip;*.db)|*.ogg;*.mp4;*.jpg;*.jpeg;*.png;*.bundle;*.zip;*.db|All Files (*.*)|*.*";
                dialog.Multiselect = true;

                if (dialog.ShowDialog() == DialogResult.OK)
                {
                    return dialog.FileNames;
                }
            }
            return null;
        }
    }
}
