using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Blue_Archive_Mod_Manager_C_.Utils;
using Blue_Archive_Mod_Manager_C_.Models;

namespace Blue_Archive_Mod_Manager_C_.Modules
{
    public class ModManager
    {
        private readonly SettingsManager _settingsManager;
        private readonly StudentIndexManager _studentIndexManager;
        private readonly string _baseModBundleDir;
        private readonly string[] _supportedExtensions = { ".ogg", ".mp4", ".jpg", ".jpeg", ".png", ".bundle", ".zip", ".db" };

        private readonly Action<string> _logger;

        public ModManager(SettingsManager settingsManager, StudentIndexManager studentIndexManager)
        {
            _settingsManager = settingsManager;
            _studentIndexManager = studentIndexManager;
            _baseModBundleDir = Path.Combine(settingsManager.GetAppDataPath(), "ModBundle");
            _logger = msg => Console.WriteLine(msg);
            
            if (!Directory.Exists(_baseModBundleDir))
            {
                Directory.CreateDirectory(_baseModBundleDir);
            }
        }

        public string GetModBundleDir(string region = "global")
        {
             var dir = Path.Combine(_baseModBundleDir, region.ToLower());
             if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
             return dir;
        }

        public List<ModData> SelectModFiles(string[] filePaths, string region = "global")
        {
            var currentMods = GetAllMods(null, region);
            var modBundleDir = GetModBundleDir(region);
            var errors = new List<string>();

            foreach (var filePath in filePaths)
            {
                if (!File.Exists(filePath)) continue;

                var fileName = Path.GetFileName(filePath);
                var modName = Path.GetFileNameWithoutExtension(fileName);
                var finalPath = Path.Combine(modBundleDir, fileName);

                // Check if mod with same filename already exists
                var existingMod = currentMods.FirstOrDefault(m => m.FileName == fileName);
                if (existingMod != null)
                {
                    // Create unique filename for this version
                    var fileExt = Path.GetExtension(fileName);
                    var baseName = Path.GetFileNameWithoutExtension(fileName);
                    var timestamp = DateTime.UtcNow.ToString("O").Replace(":", "-").Substring(0, 19);
                    var newFileName = $"{baseName}_v{timestamp}{fileExt}";
                    finalPath = Path.Combine(modBundleDir, newFileName);
                    modName = $"{modName} (v{timestamp})";
                }

                try
                {
                    File.Copy(filePath, finalPath, true);

                    var currentLocale = _settingsManager.Get<string>("language", "en");
                    var characterInfo = _studentIndexManager.ExtractCharacterInfo(fileName, currentLocale);

                    var newMod = new ModData
                    {
                        FileName = fileName,
                        ActualFileName = Path.GetFileName(finalPath),
                        ModName = modName,
                        Enabled = false,
                        Path = finalPath,
                        InstalledDate = DateTime.UtcNow.ToString("O"),
                        Character = characterInfo?.Name ?? "",
                        CharacterId = characterInfo?.Id,
                        CharacterDev = characterInfo?.DevName,
                        LastLanguage = currentLocale
                    };

                    currentMods.Add(newMod);
                    Console.WriteLine($"Added mod: {fileName} -> Character: {newMod.Character}");
                }
                catch (Exception ex)
                {
                    errors.Add($"{fileName}: {ex.Message}");
                    Console.Error.WriteLine($"Error adding mod {fileName}: {ex.Message}");
                }
            }

            SaveMods(currentMods, region);
            return currentMods;
        }

        public List<ModData> GetAllMods(string? forcedLocale = null, string region = "global")
        {
            var settingKey = $"mods_{region.ToLower()}";
            var mods = _settingsManager.Get<List<ModData>>(settingKey, new List<ModData>());
            var currentLocale = forcedLocale ?? _settingsManager.Get<string>("language", "en");
            var supportedExts = new HashSet<string>(_supportedExtensions.Select(e => e.ToLower()));
            var modBundleDir = GetModBundleDir(region);

            // Verify mod files still exist
            var validMods = new List<ModData>();
            foreach (var mod in mods)
            {
                if (string.IsNullOrWhiteSpace(mod.Id))
                {
                    mod.Id = Guid.NewGuid().ToString();
                }
                if (string.IsNullOrWhiteSpace(mod.InstalledDate))
                {
                    mod.InstalledDate = DateTime.UtcNow.ToString("O");
                }
                // Refresh character name if possible based on current locale
                if (!string.IsNullOrEmpty(mod.CharacterDev))
                {
                    var newName = _studentIndexManager.GetCharacterName(mod.CharacterDev, currentLocale);
                    if (!string.IsNullOrEmpty(newName))
                    {
                        mod.Character = newName;
                    }
                }

                if (File.Exists(mod.Path))
                {
                    validMods.Add(mod);
                }
            }

            // Discover mods that exist on disk but not in storage
            try
            {
                var files = Directory.GetFiles(modBundleDir);
                var knownPaths = new HashSet<string>(validMods.Select(m => Path.GetFullPath(m.Path)));

                foreach (var filePath in files)
                {
                    var ext = Path.GetExtension(filePath).ToLower();
                    if (!supportedExts.Contains(ext)) continue;

                    var fullPath = Path.GetFullPath(filePath);
                    if (knownPaths.Contains(fullPath)) continue;

                    // New mod discovered on disk
                    var fileName = Path.GetFileName(filePath);
                    var stats = new FileInfo(filePath);
                    var characterInfo = _studentIndexManager.ExtractCharacterInfo(fileName, currentLocale);

                    var newMod = new ModData
                    {
                        FileName = fileName,
                        ActualFileName = fileName,
                        ModName = Path.GetFileNameWithoutExtension(fileName),
                        Enabled = false,
                        Path = filePath,
                        InstalledDate = stats.LastWriteTimeUtc.ToString("O"),
                        Character = characterInfo?.Name ?? "",
                        CharacterId = characterInfo?.Id,
                        CharacterDev = characterInfo?.DevName,
                        LastLanguage = currentLocale
                    };

                    validMods.Add(newMod);
                    Console.WriteLine($"Discovered mod on disk: {fileName}");
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error discovering mods: {ex.Message}");
            }

            SaveMods(validMods, region);
            return validMods;
        }

        public ModData UpdateMod(ModData mod, string region = "global")
        {
            var mods = GetAllMods(null, region);
            var index = mods.FindIndex(m => m.Id == mod.Id);
            
            if (index >= 0)
            {
                mods[index] = mod;
                SaveMods(mods, region);
            }

            return mod;
        }

        public bool DeleteMod(string modId, string region = "global")
        {
            var mods = GetAllMods(null, region);
            var mod = mods.FirstOrDefault(m => m.Id == modId);
            
            if (mod != null)
            {
                try
                {
                    if (File.Exists(mod.Path))
                    {
                        File.Delete(mod.Path);
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Error deleting mod file: {ex.Message}");
                }

                mods.Remove(mod);
                SaveMods(mods, region);
                return true;
            }

            return false;
        }

        private void SaveMods(List<ModData> mods, string region)
        {
            var settingKey = $"mods_{region.ToLower()}";
            _settingsManager.Set(settingKey, mods);
        }

        public async Task ApplyModsAsync(List<string> selectedModIds, GamePathManager gamePathManager, string region = "global")
        {
            var jpMapping = ShouldUseJpMapping(region) ? LoadJpOriginalToHashMap() : null;

            await Task.Run(async () =>
            {
                // We need to load from the specific region list, OR assume the Ids are unique enough?
                // Safest to load the list for the region.
                var mods = GetAllMods(null, region); 
                var (gamePath, bundlePath) = gamePathManager.GetGamePaths(); // GamePathManager needs to know region? NO, GamePathManager returns current configured path.
                // Wait, if I switch region in UI, does GamePathManager switch paths?
                // The current implementation of GamePathManager.GetGamePaths() just returns stored "gamePath" from settings.
                // It does NOT separate Global vs JP paths in settings storage yet, it overrwrites "gamePath" key.
                // This means when user switches server in UI, they *must* redetect path.
                // Which is handled by `findGamePathAuto(false)` in renderer.js listener.
                // So at this point, `gamePathManager` should assume the correct path is set.
                
                if (string.IsNullOrEmpty(bundlePath) || !Directory.Exists(bundlePath))
                {
                    _logger("Bundle path not configured or missing.");
                    return;
                }

                var selected = mods.Where(m => selectedModIds.Contains(m.Id)).ToList();
                foreach (var mod in selected)
                {
                    var modPath = mod.Path;
                    if (!File.Exists(modPath))
                    {
                        _logger($"Mod file missing: {modPath}");
                        continue;
                    }

                    var targetFileName = !string.IsNullOrEmpty(mod.FileName) ? mod.FileName : Path.GetFileName(mod.Path);
                    targetFileName = ResolveTargetFileName(targetFileName, region, jpMapping);
                    var targetPath = gamePathManager.FindTargetFile(targetFileName);
                    if (string.IsNullOrEmpty(targetPath))
                    {
                        _logger($"Target file not found for mod: {targetFileName}");
                        continue;
                    }

                    var backupPath = targetPath + ".bak";
                    try
                    {
                        if (!File.Exists(backupPath))
                        {
                            File.Copy(targetPath, backupPath, true);
                            _logger($"Backup created: {backupPath}");
                        }

                        var success = await Utils.CrcPatcher.ManipulateCrcAsync(backupPath, modPath, targetPath, _logger);
                        if (success)
                        {
                            mod.Enabled = true;
                            _logger($"Applied mod: {mod.FileName}");
                        }
                        else
                        {
                            _logger($"Failed to apply CRC patch for: {mod.FileName}");
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger($"Error applying mod {mod.FileName}: {ex.Message}");
                    }
                }

                SaveMods(mods, region);
            });
        }

        public async Task<List<string>> UninstallModsAsync(List<string> selectedModIds, GamePathManager gamePathManager, string region = "global")
        {
            var jpMapping = ShouldUseJpMapping(region) ? LoadJpOriginalToHashMap() : null;
            return await Task.Run(() =>
            {
                var errors = new List<string>();
                var (gamePath, bundlePath) = gamePathManager.GetGamePaths();
                var mods = GetAllMods(null, region);
                var selected = mods.Where(m => selectedModIds.Contains(m.Id)).ToList();

                foreach (var mod in selected)
                {
                    var targetFileName = !string.IsNullOrEmpty(mod.FileName) ? mod.FileName : Path.GetFileName(mod.Path);
                    targetFileName = ResolveTargetFileName(targetFileName, region, jpMapping);
                    var targetPath = gamePathManager.FindTargetFile(targetFileName);
                    if (string.IsNullOrEmpty(targetPath))
                    {
                        var msg = $"Target file not found for uninstall: {targetFileName}";
                        _logger(msg);
                        errors.Add(msg);
                        // If target not found, we can't restore. But should we disable?
                        // If file is gone, mod is effectively gone from game.
                        mod.Enabled = false; 
                        continue;
                    }

                    var backupPath = targetPath + ".bak";
                    try
                    {
                        if (File.Exists(backupPath))
                        {
                            File.Copy(backupPath, targetPath, true);
                            _logger($"Restored backup for: {targetFileName}");
                        }
                        mod.Enabled = false;
                    }
                    catch (Exception ex)
                    {
                        var msg = $"Error restoring {targetFileName}: {ex.Message}";
                        _logger(msg);
                        errors.Add(msg);
                    }
                }

                SaveMods(mods, region);
                return errors;
            });
        }

        private static bool ShouldUseJpMapping(string region)
        {
            return region.Equals("jp", StringComparison.OrdinalIgnoreCase);
        }

        private string ResolveTargetFileName(string originalName, string region, IReadOnlyDictionary<string, string>? jpMapping)
        {
            if (string.IsNullOrWhiteSpace(originalName)) return originalName;
            if (!ShouldUseJpMapping(region)) return originalName;

            var extension = Path.GetExtension(originalName);
            if (extension.Equals(".bundle", StringComparison.OrdinalIgnoreCase))
            {
                return originalName;
            }

            if (jpMapping == null || jpMapping.Count == 0)
            {
                _logger("JP mapping table is empty or missing. Falling back to original filename.");
                return originalName;
            }

            var key = Path.GetFileName(originalName);
            if (string.IsNullOrEmpty(key)) return originalName;

            if (jpMapping.TryGetValue(key, out var hashedName) && !string.IsNullOrWhiteSpace(hashedName))
            {
                return hashedName;
            }

            _logger($"JP mapping entry not found for {key}, using original filename.");
            return originalName;
        }

        private IReadOnlyDictionary<string, string> LoadJpOriginalToHashMap()
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var mappingPath = Path.Combine(_settingsManager.GetAppDataPath(), "Exports", "Mapping.json");
                if (!File.Exists(mappingPath))
                {
                    _logger("Mapping.json not found. Please create it from the JP tools before applying mods.");
                    return result;
                }

                var json = File.ReadAllText(mappingPath);
                var hashedToOriginal = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
                if (hashedToOriginal == null)
                {
                    _logger("Mapping.json is empty or invalid.");
                    return result;
                }

                foreach (var kvp in hashedToOriginal)
                {
                    if (string.IsNullOrWhiteSpace(kvp.Value) || string.IsNullOrWhiteSpace(kvp.Key)) continue;
                    var originalName = Path.GetFileName(kvp.Value);
                    if (string.IsNullOrEmpty(originalName)) continue;

                    if (!result.ContainsKey(originalName))
                    {
                        result[originalName] = kvp.Key;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger($"Failed to load JP mapping: {ex.Message}");
            }

            return result;
        }
    }
}
