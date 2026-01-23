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

        public async Task<string> FindGameExecutableAsync(string region, Action<string>? statusCallback = null)
        {
            try
            {
                if (region != null && region.Equals("jp", StringComparison.OrdinalIgnoreCase))
                {
                    statusCallback?.Invoke("Starting JP Game Detection...");
                    var jpPath = await FindGameViaJpLauncherAsync(statusCallback);
                    if (!string.IsNullOrEmpty(jpPath))
                    {
                        SaveGamePaths(jpPath);
                        return jpPath;
                    }
                     // If JP specific detection fails, should we fall back to generic drive search?
                     // Yes, but we might find Global version. 
                     // Let's assume the user knows what they are doing if they selected JP.
                     statusCallback?.Invoke("JP Launcher method failed. Searching drives...");
                }
                else
                {
                    // Global (Steam) detection
                    var steamGamePath = await FindGameViaSteamAsync(statusCallback);
                    if (!string.IsNullOrEmpty(steamGamePath))
                    {
                        SaveGamePaths(steamGamePath);
                        return steamGamePath;
                    }
                    statusCallback?.Invoke("Steam search failed. Searching drives...");
                }
                
                await Task.Delay(2000);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Search error: {ex.Message}");
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

        public async Task<string> FindGameViaJpLauncherAsync(Action<string>? statusCallback = null)
        {
            try
            {
                var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                // User provided: AppData\Roaming\BlueArchive_JP_Gamelauncher\Local Storage\leveldb\000003.log
                var logPath = Path.Combine(appData, "BlueArchive_JP_Gamelauncher", "Local Storage", "leveldb", "000003.log");
                
                statusCallback?.Invoke($"Checking JP Launcher log: {logPath}");

                if (File.Exists(logPath))
                {
                    // Try to read the file and look for paths
                    // The file is likely binary (LevelDB), but might contain plain text paths.
                    // We'll read it as string and regex search for absolute paths ending in BlueArchive.exe
                    // Or generically, paths containing "BlueArchive"
                    
                    // Note: LevelDB log files might be locked if launcher is running.
                    string content = "";
                    try 
                    {
                        using (var fs = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                        using (var sr = new StreamReader(fs))
                        {
                            content = await sr.ReadToEndAsync();
                        }
                    }
                    catch (Exception readEx)
                    {
                         statusCallback?.Invoke($"Failed to read log: {readEx.Message}");
                         // Fallback: Check if the folder exists, maybe standard install location?
                         // Standard Yostar install: C:\Program Files\BlueArchiveJP ?
                         return null;
                    }

                    // Regex for path
                    // Pattern: Drive letter, colon, backslash, characters, BlueArchive.exe
                    // Note: Paths in logs might be escaped or use forward slashes.
                    // Updated to handle directory paths seen in logs like "C:\\YostarGames\\BlueArchive_JP"
                    var patterns = new[] 
                    {
                        // Match specific exe path if present
                        @"([a-zA-Z]:[\\/](?:[^<>:""/\\|?*]+[\\/])+BlueArchive\.exe)",
                        // Match quoted directory paths with double backslashes (common in JSON/C strings)
                        @"([a-zA-Z]:\\\\(?:[^""\x00-\x1F]+))"
                    };

                    foreach (var pat in patterns)
                    {
                        var matches = System.Text.RegularExpressions.Regex.Matches(content, pat, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                        foreach (System.Text.RegularExpressions.Match match in matches)
                        {
                             var rawPath = match.Groups[1].Value;
                             var path = rawPath.Replace("\\\\", "\\").Replace("/", "\\"); // Normalize
                             
                             // If path matches a directory, append exe name
                             if (!path.EndsWith("BlueArchive.exe", StringComparison.OrdinalIgnoreCase))
                             {
                                 path = Path.Combine(path, "BlueArchive.exe");
                             }

                             if (File.Exists(path))
                             {
                                 statusCallback?.Invoke($"Found JP Game at: {path}");
                                 return path;
                             }
                        }
                    }
                    
                    statusCallback?.Invoke("No valid game path found in log file.");
                }
                else 
                {
                    statusCallback?.Invoke("JP Launcher log file not found.");
                }
            }
            catch (Exception ex)
            {
                 Console.Error.WriteLine($"JP Launcher search error: {ex.Message}");
            }
            
            return null;
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
