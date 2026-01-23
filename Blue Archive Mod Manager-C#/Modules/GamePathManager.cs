using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Win32;
using Blue_Archive_Mod_Manager_C_.Utils;

namespace Blue_Archive_Mod_Manager_C_.Modules
{
    public class GamePathManager
    {
        private readonly SettingsManager _settingsManager;

        public GamePathManager(SettingsManager settingsManager)
        {
            _settingsManager = settingsManager;
        }

        public string GetSteamInstallPath()
        {
            try
            {
                // Try 64-bit registry first
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam"))
                {
                    if (key?.GetValue("InstallPath") is string path64)
                        return path64;
                }

                // Try 32-bit registry
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Valve\Steam"))
                {
                    if (key?.GetValue("InstallPath") is string path32)
                        return path32;
                }
            }
            catch
            {
                // Registry access failed
            }

            return null!;
        }

        public async Task<string> FindGameViaSteamAsync(Action<string>? statusCallback = null)
        {
            statusCallback?.Invoke("Finding Steam installation...");
            
            var steamPath = GetSteamInstallPath();
            if (string.IsNullOrEmpty(steamPath))
            {
                statusCallback?.Invoke("Steam not found in registry.");
                return null;
            }

            statusCallback?.Invoke($"Steam found at: {steamPath}");
            await Task.Delay(1000);

            var libraryFoldersPath = Path.Combine(steamPath, "steamapps", "libraryfolders.vdf");
            if (!File.Exists(libraryFoldersPath))
            {
                statusCallback?.Invoke("libraryfolders.vdf not found.");
                return null;
            }

            var libraryPaths = new List<string> { steamPath };
            
            try
            {
                var content = File.ReadAllText(libraryFoldersPath);
                var pathMatches = System.Text.RegularExpressions.Regex.Matches(content, @"""path""\s+""([^""]+)""");
                
                foreach (System.Text.RegularExpressions.Match match in pathMatches)
                {
                    var libPath = match.Groups[1].Value.Replace("\\\\", "\\");
                    if (Directory.Exists(libPath))
                    {
                        libraryPaths.Add(libPath);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error reading libraryfolders.vdf: {ex.Message}");
            }

            var appId = "3557620"; // Blue Archive Steam App ID
            var manifestFile = $"appmanifest_{appId}.acf";

            foreach (var libPath in libraryPaths)
            {
                statusCallback?.Invoke($"Checking Steam library: {libPath}");
                
                var manifestPath = Path.Combine(libPath, "steamapps", manifestFile);
                if (!File.Exists(manifestPath)) continue;

                try
                {
                    var manifestContent = File.ReadAllText(manifestPath);
                    var match = System.Text.RegularExpressions.Regex.Match(manifestContent, @"""installdir""\s+""([^""]+)""");
                    
                    if (match.Success)
                    {
                        var installDir = match.Groups[1].Value;
                        var gameExePath = Path.Combine(libPath, "steamapps", "common", installDir, "BlueArchive.exe");
                        
                        if (File.Exists(gameExePath))
                        {
                            statusCallback?.Invoke($"Found Blue Archive at: {gameExePath}");
                            await Task.Delay(1500);
                            return gameExePath;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Error checking manifest: {ex.Message}");
                }
            }

            statusCallback?.Invoke("Blue Archive not found in Steam libraries.");
            return null;
        }

        public List<string> GetDriveLetters()
        {
            try
            {
                return DriveInfo.GetDrives()
                    .Where(d => d.IsReady)
                    .Select(d => d.Name)
                    .ToList();
            }
            catch
            {
                return new List<string> { "C:\\", "D:\\", "E:\\" };
            }
        }

        public async Task<string> FindGameExecutableAsync(Action<string>? statusCallback = null)
        {
            try
            {
                var steamGamePath = await FindGameViaSteamAsync(statusCallback);
                if (!string.IsNullOrEmpty(steamGamePath))
                {
                    SaveGamePaths(steamGamePath);
                    return steamGamePath;
                }

                statusCallback?.Invoke("Steam search failed. Searching drives...");
                await Task.Delay(2000);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Steam search error: {ex.Message}");
            }

            statusCallback?.Invoke("Preparing drive search...");
            var drives = GetDriveLetters();
            statusCallback?.Invoke($"Found drives: {string.Join(", ", drives)}");
            
            await Task.Delay(1000);

            foreach (var drive in drives)
            {
                try
                {
                    statusCallback?.Invoke($"Scanning drive: {drive}");
                    var result = SearchDriveForGame(drive, 7, statusCallback);
                    
                    if (!string.IsNullOrEmpty(result))
                    {
                        SaveGamePaths(result);
                        statusCallback?.Invoke($"Found: {result}");
                        return result;
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Error searching {drive}: {ex.Message}");
                }
            }

            statusCallback?.Invoke("Blue Archive not found.");
            return null!;
        }

        private string SearchDriveForGame(string drivePath, int maxDepth, Action<string>? statusCallback = null)
        {
            try
            {
                var searchTasks = new Stack<(string path, int depth)>();
                searchTasks.Push((drivePath, 0));

                var excludedDirs = new[] 
                { 
                    "$RECYCLE.BIN", "System Volume Information", "Windows", 
                    "ProgramData", "$WinREAgent", "Recovery" 
                };

                while (searchTasks.Count > 0)
                {
                    var (currentPath, depth) = searchTasks.Pop();

                    if (depth > maxDepth) continue;

                    try
                    {
                        var files = Directory.GetFiles(currentPath, "BlueArchive.exe", System.IO.SearchOption.TopDirectoryOnly);
                        if (files.Length > 0)
                        {
                            return files[0];
                        }

                        foreach (var dir in Directory.GetDirectories(currentPath))
                        {
                            var dirName = Path.GetFileName(dir);
                            if (!excludedDirs.Contains(dirName, StringComparer.OrdinalIgnoreCase))
                            {
                                searchTasks.Push((dir, depth + 1));
                            }
                        }
                    }
                    catch
                    {
                // Skip directories we can't access
                    }
                }
            }
            catch
            {
                // Search failed
            }

            return null!;
        }

        public (string gamePath, string gameBundlePath) SaveGamePaths(string executablePath)
        {
            var gameDirectory = Path.GetDirectoryName(executablePath);
            var bundlePath = Path.Combine(gameDirectory, "BlueArchive_Data");
            
            _settingsManager.Set(new Dictionary<string, object>
            {
                { "gamePath", executablePath },
                { "gameBundlePath", bundlePath }
            });

            return (executablePath, bundlePath);
        }

        public (string gamePath, string gameBundlePath) GetGamePaths()
        {
            var gamePath = _settingsManager.Get<string>("gamePath");
            var bundlePath = _settingsManager.Get<string>("gameBundlePath");
            return (gamePath, bundlePath);
        }

        public string? FindTargetFile(string fileName, int maxDepth = 6)
        {
            var (_, bundlePath) = GetGamePaths();
            if (string.IsNullOrEmpty(bundlePath) || !Directory.Exists(bundlePath))
            {
                return null;
            }

            var direct = Path.Combine(bundlePath, fileName);
            if (File.Exists(direct)) return direct;

            var stack = new Stack<(string path, int depth)>();
            stack.Push((bundlePath, 0));
            var skipDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "Cache", "Logs", "Temp", "TempCache"
            };

            while (stack.Count > 0)
            {
                var (current, depth) = stack.Pop();
                if (depth > maxDepth) continue;

                try
                {
                    var files = Directory.GetFiles(current, fileName, SearchOption.TopDirectoryOnly);
                    if (files.Length > 0) return files[0];

                    foreach (var dir in Directory.GetDirectories(current))
                    {
                        var name = Path.GetFileName(dir);
                        if (skipDirs.Contains(name)) continue;
                        stack.Push((dir, depth + 1));
                    }
                }
                catch
                {
                    // ignore inaccessible dirs
                }
            }

            return null;
        }
    }
}
