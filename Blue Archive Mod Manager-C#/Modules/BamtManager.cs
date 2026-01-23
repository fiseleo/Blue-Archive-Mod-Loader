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

        public async Task LaunchBamtAsync(Action<string, int?> statusCallback)
        {
            try
            {
                var exePath = FindBamtExecutable();
                if (string.IsNullOrEmpty(exePath))
                {
                    statusCallback("Downloading BAMT...", 0);
                    if (await DownloadAndExtractBamtAsync(statusCallback))
                    {
                        exePath = FindBamtExecutable();
                    }
                }

                if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
                {
                    statusCallback("Launching BAMT...", 100);
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        WorkingDirectory = Path.GetDirectoryName(exePath),
                        UseShellExecute = true
                    });
                    statusCallback("BAMT Launched!", null);
                }
                else
                {
                    statusCallback("Failed to find BAMT executable.", null);
                }
            }
            catch (Exception ex)
            {
                statusCallback($"Error: {ex.Message}", null);
                _logger($"Error launching BAMT: {ex.Message}");
            }
        }

        private string? FindBamtExecutable()
        {
            if (!Directory.Exists(_toolsDir)) return null;
            return Directory.GetFiles(_toolsDir, "BA-Modding-Toolkit.exe", SearchOption.AllDirectories).FirstOrDefault();
        }

        private async Task<bool> DownloadAndExtractBamtAsync(Action<string, int?> statusCallback)
        {
            try
            {
                if (!Directory.Exists(_toolsDir)) Directory.CreateDirectory(_toolsDir);

                using var client = new HttpClient();
                client.DefaultRequestHeaders.Add("User-Agent", "Blue-Archive-Mod-Manager");

                statusCallback("Checking latest release...", null);
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
                    statusCallback("No suitable download found in latest release.", null);
                    return false;
                }

                statusCallback("Downloading...", 0);
                var zipPath = Path.Combine(_toolsDir, "bamt_update.zip");

                using (var downloadResponse = await client.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead))
                {
                    downloadResponse.EnsureSuccessStatusCode();
                    var totalBytes = downloadResponse.Content.Headers.ContentLength ?? -1L;
                    var canReportProgress = totalBytes != -1;

                    using (var contentStream = await downloadResponse.Content.ReadAsStreamAsync())
                    using (var fileStream = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None, 8192, true))
                    {
                        var buffer = new byte[8192];
                        var totalRead = 0L;
                        var bytesRead = 0;

                        while ((bytesRead = await contentStream.ReadAsync(buffer, 0, buffer.Length)) > 0)
                        {
                            await fileStream.WriteAsync(buffer, 0, bytesRead);
                            totalRead += bytesRead;
                            if (canReportProgress)
                            {
                                var progress = (int)((double)totalRead / totalBytes * 100);
                                statusCallback($"Downloading... {progress}%", progress);
                            }
                        }
                    }
                }

                statusCallback("Extracting...", 100);
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
                statusCallback($"Download failed: {ex.Message}", null);
                _logger($"Download failed: {ex.Message}");
                return false;
            }
        }
    }
}
