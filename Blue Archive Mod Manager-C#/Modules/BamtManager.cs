using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Blue_Archive_Mod_Manager_C_.Utils;

namespace Blue_Archive_Mod_Manager_C_.Modules
{
    public class BamtManager
    {
        private readonly string _toolsDir;
        private readonly Action<string> _logger;

        public BamtManager(SettingsManager settingsManager)
        {
            _toolsDir = Path.Combine(settingsManager.GetAppDataPath(), "Tools", "BAMT");
            _logger = msg => Console.WriteLine($"[BAMT] {msg}");
        }

        public async Task LaunchBamtAsync(Action<string> statusCallback)
        {
            try
            {
                var exePath = FindBamtExecutable();
                if (string.IsNullOrEmpty(exePath))
                {
                    statusCallback("Downloading BAMT...");
                    if (await DownloadAndExtractBamtAsync(statusCallback))
                    {
                        exePath = FindBamtExecutable();
                    }
                }

                if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
                {
                    statusCallback("Launching BAMT...");
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        WorkingDirectory = Path.GetDirectoryName(exePath),
                        UseShellExecute = true
                    });
                    statusCallback("BAMT Launched!");
                }
                else
                {
                    statusCallback("Failed to find BAMT executable.");
                }
            }
            catch (Exception ex)
            {
                statusCallback($"Error: {ex.Message}");
                _logger($"Error launching BAMT: {ex.Message}");
            }
        }

        private string? FindBamtExecutable()
        {
            if (!Directory.Exists(_toolsDir)) return null;
            return Directory.GetFiles(_toolsDir, "BA-Modding-Toolkit.exe", SearchOption.AllDirectories).FirstOrDefault();
        }

        private async Task<bool> DownloadAndExtractBamtAsync(Action<string> statusCallback)
        {
            try
            {
                if (!Directory.Exists(_toolsDir)) Directory.CreateDirectory(_toolsDir);

                using var client = new HttpClient();
                client.DefaultRequestHeaders.Add("User-Agent", "Blue-Archive-Mod-Manager");

                statusCallback("Checking latest release...");
                var releasesUrl = "https://api.github.com/repos/Agent-0808/BA-Modding-Toolkit/releases/latest";
                var response = await client.GetStringAsync(releasesUrl);
                var releaseData = JsonDocument.Parse(response);
                
                string downloadUrl = null;
                if (releaseData.RootElement.TryGetProperty("assets", out var assets))
                {
                    foreach (var asset in assets.EnumerateArray())
                    {
                        var name = asset.GetProperty("name").GetString();
                        if (name != null)
                        {
                            // Prefer zip, accept rar or 7z if needed but zip is standard for this repo usually
                            if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) 
                            {
                                downloadUrl = asset.GetProperty("browser_download_url").GetString();
                                break;
                            }
                        }
                    }
                }

                if (string.IsNullOrEmpty(downloadUrl))
                {
                    statusCallback("No suitable download found in latest release.");
                    return false;
                }

                statusCallback("Downloading...");
                var zipPath = Path.Combine(_toolsDir, "bamt_update.zip");
                var zipBytes = await client.GetByteArrayAsync(downloadUrl);
                await File.WriteAllBytesAsync(zipPath, zipBytes);

                statusCallback("Extracting...");
                // Clean old files
                foreach (var file in Directory.GetFiles(_toolsDir))
                {
                    if (file != zipPath) 
                    {
                        try { File.Delete(file); } catch { } 
                    }
                }
                foreach (var dir in Directory.GetDirectories(_toolsDir))
                {
                    try { Directory.Delete(dir, true); } catch { }
                }

                ZipFile.ExtractToDirectory(zipPath, _toolsDir, true);
                File.Delete(zipPath); // Cleanup zip

                return true;
            }
            catch (Exception ex)
            {
                statusCallback($"Download failed: {ex.Message}");
                _logger($"Download failed: {ex.Message}");
                return false;
            }
        }
    }
}
