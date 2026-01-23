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
        private LocalizationManager? _localizationManager;
        private GamePathManager? _gamePathManager;
        private StudentIndexManager? _studentIndexManager;
        private ModManager? _modManager;
        private BamtManager? _bamtManager;
        private CatalogManager? _catalogManager;
        private WebViewBridge? _webBridge;

        public Form1()
        {
            InitializeComponent();
            InitializeModules();
            
            var disclaimerMsg = _localizationManager?.T("disclaimer.message") ?? "This program is Blue Archive Mod Manager. Mods are unofficial assets. Use at your own risk.";
            var disclaimerTitle = _localizationManager?.T("disclaimer.title") ?? "Disclaimer";
            
            MessageBox.Show(disclaimerMsg, disclaimerTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            InitializeWebView();
        }

        private void InitializeModules()
        {
            try
            {
                _settingsManager = new SettingsManager();
                _localizationManager = new LocalizationManager();
                _gamePathManager = new GamePathManager(_settingsManager);
                _studentIndexManager = new StudentIndexManager(_settingsManager);
                _modManager = new ModManager(_settingsManager, _studentIndexManager);
                _bamtManager = new BamtManager(_settingsManager);
                _catalogManager = new CatalogManager(_gamePathManager, _settingsManager);
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
                if (_studentIndexManager != null)
                {
                    await _studentIndexManager.InitializeIndexAsync();
                }

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

            _webBridge.RegisterHandler("getTranslations", async (payload) =>
            {
                try
                {
                    var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                    var translationsPath = Path.Combine(baseDir, "Web", "translations.json");
                    if (!File.Exists(translationsPath)) return null;

                    var json = await File.ReadAllTextAsync(translationsPath);
                    var doc = JsonDocument.Parse(json);
                    return doc.RootElement.Clone();
                }
                catch (Exception ex)
                {
                    return new { error = ex.Message };
                }
            });

            _webBridge.RegisterHandler("findGamePathAuto", async (payload) =>
            {
                if (_gamePathManager == null)
                    return new { error = "GamePathManager not initialized" };

                try
                {
                    string region = "global";
                    if (payload.ValueKind == System.Text.Json.JsonValueKind.String)
                    {
                        region = payload.GetString() ?? "global";
                    }

                    var gamePath = await _gamePathManager.FindGameExecutableAsync(region, async (status) =>
                    {
                        await _webBridge.SendNotificationAsync("gamePathStatus", new { status });
                    });

                    if (!string.IsNullOrEmpty(gamePath))
                    {
                        var gameDirectory = Path.GetDirectoryName(gamePath);
                         // Note: Bundle path might differ for JP? Global uses BlueArchive_Data.
                         // Usually Unity games use <ExeName>_Data.
                         // If the JP exe is named differently, this folder name might be different.
                         // But usually it's BlueArchive_Data for global.
                         // Let's rely on GamePathManager to just return the path, and here we might need to be smarter about the data folder.
                         // But for now let's assume standard Unity structure.
                         // However, if the exe is "BlueArchive.exe", data is "BlueArchive_Data".
                         // If JP exe is "BlueArchive.exe", it's the same.
                        var exeName = Path.GetFileNameWithoutExtension(gamePath);
                        var bundlePath = Path.Combine(gameDirectory, $"{exeName}_Data");
                        
                        // We should probably rely on GamePathManager to update the stored paths too?
                        // The existing code did: var paths = _gamePathManager.SaveGamePaths(result); in selectGamePath.
                        // But in findGamePathAuto it didn't call SaveGamePaths explicitly, does FindGameExecutableAsync do it?

                        // Let's check GamePathManager implementation next.
                        
                        return new { gamePath, gameBundlePath = bundlePath };
                    }

                    return new { error = "Game not found" };
                }
                catch (Exception ex)
                {
                    return new { error = ex.Message };
                }
            });

            // Mod handlers
            _webBridge.RegisterHandler("getMods", async (payload) =>
            {
                var locale = _localizationManager?.CurrentLocale;
                string region = "global";
                if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("region", out var regProp))
                {
                    region = regProp.GetString() ?? "global";
                }
                var mods = _modManager.GetAllMods(locale, region);
                return mods;
            });

            _webBridge.RegisterHandler("selectModFiles", async (payload) =>
            {
                string region = "global";
                if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("region", out var regProp))
                {
                    region = regProp.GetString() ?? "global";
                }

                var files = SelectModFilesDialog();
                if (files != null && files.Length > 0)
                {
                    var mods = _modManager.SelectModFiles(files, region);
                    return new { mods, errors = new List<string>() };
                }
                return null;
            });

            _webBridge.RegisterHandler("updateMod", async (payload) =>
            {
                string region = "global";
                ModData mod = null;

                if (payload.ValueKind == JsonValueKind.Object)
                {
                    if (payload.TryGetProperty("region", out var regProp)) region = regProp.GetString() ?? "global";
                    
                    if (payload.TryGetProperty("mod", out var modProp))
                    {
                        mod = JsonSerializer.Deserialize<ModData>(modProp.GetRawText());
                    }
                    else if (payload.TryGetProperty("Id", out _)) // Backwards compatibility
                    {
                        mod = JsonSerializer.Deserialize<ModData>(payload.GetRawText());
                    }
                }

                if (mod != null)
                {
                    return _modManager.UpdateMod(mod, region);
                }
                return null;
            });

            _webBridge.RegisterHandler("deleteMod", async (payload) =>
            {
                string region = "global";
                string modId = null;

                if (payload.ValueKind == JsonValueKind.Object)
                {
                    if (payload.TryGetProperty("region", out var regProp)) region = regProp.GetString() ?? "global";
                    if (payload.TryGetProperty("modId", out var idProp)) modId = idProp.GetString();
                }
                else if (payload.ValueKind == JsonValueKind.String)
                {
                    modId = payload.GetString();
                }

                if (modId != null)
                {
                    return _modManager.DeleteMod(modId, region);
                }
                return false;
            });

            // Action handlers
            _webBridge.RegisterHandler("applyMods", async (payload) =>
            {
                try
                {
                    string region = "global";
                    List<string> selectedIds = new();

                    if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("modIds", out var idsProp))
                    {
                         if (payload.TryGetProperty("region", out var regProp)) region = regProp.GetString() ?? "global";
                         selectedIds = JsonSerializer.Deserialize<List<string>>(idsProp.GetRawText());
                    }
                    else if (payload.ValueKind == JsonValueKind.Array)
                    {
                        selectedIds = JsonSerializer.Deserialize<List<string>>(payload.GetRawText());
                    }

                    await _modManager.ApplyModsAsync(selectedIds, _gamePathManager, region);
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
                    string region = "global";
                    List<string> selectedIds = new();

                    if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("modIds", out var idsProp))
                    {
                         if (payload.TryGetProperty("region", out var regProp)) region = regProp.GetString() ?? "global";
                         selectedIds = JsonSerializer.Deserialize<List<string>>(idsProp.GetRawText());
                    }
                    else if (payload.ValueKind == JsonValueKind.Array)
                    {
                        selectedIds = JsonSerializer.Deserialize<List<string>>(payload.GetRawText());
                    }

                    var errors = await _modManager.UninstallModsAsync(selectedIds, _gamePathManager, region);
                    
                    if (errors.Count > 0)
                    {
                        var errorMsg = "Uninstall completed with errors:\n" + string.Join("\n", errors);
                        // Send visible notification of error
                        // We return error object so frontend throws and alerts
                        return new { error = errorMsg };
                    }
                    
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
                    string region = "global";
                    if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("region", out var regProp))
                    {
                        region = regProp.GetString() ?? "global";
                    }

                    if (region.Equals("jp", StringComparison.OrdinalIgnoreCase))
                    {
                        if (_gamePathManager == null)
                        {
                            return new { error = "GamePathManager not initialized" };
                        }

                        var (gameExePath, _) = _gamePathManager.GetGamePaths();
                        if (string.IsNullOrEmpty(gameExePath))
                        {
                            return new { error = "尚未設定日服遊戲路徑，請先偵測或手動設定。" };
                        }

                        var gameDirectory = Path.GetDirectoryName(gameExePath);
                        if (string.IsNullOrEmpty(gameDirectory))
                        {
                            return new { error = "無法取得日服遊戲目錄。" };
                        }

                        var runBatPath = Path.Combine(gameDirectory, "run.bat");
                        if (!File.Exists(runBatPath))
                        {
                            return new { error = $"找不到 run.bat：{runBatPath}" };
                        }

                        Process.Start(new ProcessStartInfo
                        {
                            FileName = runBatPath,
                            WorkingDirectory = gameDirectory,
                            UseShellExecute = true
                        });

                        return new { success = true };
                    }

                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "steam://run/3557620",
                        UseShellExecute = true
                    });
                    return new { success = true };
                }
                catch (Exception ex)
                {
                    return new { error = ex.Message };
                }
            });

            _webBridge.RegisterHandler("launchBamt", async (payload) =>
            {
                if (_bamtManager == null) return new { error = "BamtManager not initialized" };
                
                await _bamtManager.LaunchBamtAsync(async (status, progress) => 
                {
                    await _webBridge.SendNotificationAsync("bamtStatus", new { status, progress });
                });
                return true;
            });

            _webBridge.RegisterHandler("createDetailJson", async (payload) =>
            {
                if (_catalogManager == null) return new { error = "CatalogManager not initialized" };
                
                try 
                {
                    string region = "global";
                    if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("region", out var regProp))
                    {
                        region = regProp.GetString() ?? "global";
                    }

                    var exportPath = await _catalogManager.ExportCatalogJsonAsync(region);
                    
                    if (exportPath.StartsWith("Error:"))
                    {
                        return new { error = exportPath };
                    }

                    // Open the folder
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exportPath,
                        UseShellExecute = true,
                        Verb = "open"
                    });

                    return new { success = true, path = exportPath };
                }
                catch (Exception ex)
                {
                    return new { error = ex.Message };
                }
            });

            _webBridge.RegisterHandler("createMappingJson", async (payload) =>
            {
                if (_catalogManager == null) return new { error = "CatalogManager not initialized" };
                
                try 
                {
                    string region = "global";
                    if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("region", out var regProp))
                    {
                        region = regProp.GetString() ?? "global";
                    }

                    var exportPath = await _catalogManager.ExportMappingJsonAsync(region);
                    
                    if (exportPath.StartsWith("Error:"))
                    {
                        return new { error = exportPath };
                    }

                    // Open the folder
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exportPath,
                        UseShellExecute = true,
                        Verb = "open"
                    });

                    return new { success = true, path = exportPath };
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
