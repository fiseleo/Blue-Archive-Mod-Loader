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
        private readonly string _modBundleDir;
        private readonly string[] _supportedExtensions = { ".ogg", ".mp4", ".jpg", ".jpeg", ".png", ".bundle", ".zip", ".db" };

        public ModManager(SettingsManager settingsManager, StudentIndexManager studentIndexManager)
        {
            _settingsManager = settingsManager;
            _studentIndexManager = studentIndexManager;
            _modBundleDir = Path.Combine(settingsManager.GetAppDataPath(), "ModBundle");
            
            if (!Directory.Exists(_modBundleDir))
            {
                Directory.CreateDirectory(_modBundleDir);
            }
        }

        public string GetModBundleDir() => _modBundleDir;

        public List<ModData> SelectModFiles(string[] filePaths)
        {
            var currentMods = GetAllMods();
            var errors = new List<string>();

            if (!Directory.Exists(_modBundleDir))
            {
                try
                {
                    Directory.CreateDirectory(_modBundleDir);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Failed to create ModBundle directory: {ex.Message}");
                    return currentMods;
                }
            }

            foreach (var filePath in filePaths)
            {
                if (!File.Exists(filePath)) continue;

                var fileName = Path.GetFileName(filePath);
                var modName = Path.GetFileNameWithoutExtension(fileName);
                var finalPath = Path.Combine(_modBundleDir, fileName);

                // Check if mod with same filename already exists
                var existingMod = currentMods.FirstOrDefault(m => m.FileName == fileName);
                if (existingMod != null)
                {
                    // Create unique filename for this version
                    var fileExt = Path.GetExtension(fileName);
                    var baseName = Path.GetFileNameWithoutExtension(fileName);
                    var timestamp = DateTime.UtcNow.ToString("O").Replace(":", "-").Substring(0, 19);
                    var newFileName = $"{baseName}_v{timestamp}{fileExt}";
                    finalPath = Path.Combine(_modBundleDir, newFileName);
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

            SaveMods(currentMods);
            return currentMods;
        }

        public List<ModData> GetAllMods()
        {
            var mods = _settingsManager.Get<List<ModData>>("mods", new List<ModData>());
            var currentLocale = _settingsManager.Get<string>("language", "en");
            var supportedExts = new HashSet<string>(_supportedExtensions.Select(e => e.ToLower()));

            // Verify mod files still exist
            var validMods = new List<ModData>();
            foreach (var mod in mods)
            {
                if (File.Exists(mod.Path))
                {
                    validMods.Add(mod);
                }
            }

            // Discover mods that exist on disk but not in storage
            try
            {
                var files = Directory.GetFiles(_modBundleDir);
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

            SaveMods(validMods);
            return validMods;
        }

        public ModData UpdateMod(ModData mod)
        {
            var mods = GetAllMods();
            var index = mods.FindIndex(m => m.Id == mod.Id);
            
            if (index >= 0)
            {
                mods[index] = mod;
                SaveMods(mods);
            }

            return mod;
        }

        public bool DeleteMod(string modId)
        {
            var mods = GetAllMods();
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
                SaveMods(mods);
                return true;
            }

            return false;
        }

        private void SaveMods(List<ModData> mods)
        {
            _settingsManager.Set("mods", mods);
        }

        public void ApplyMods(List<string> selectedModIds, GamePathManager gamePathManager)
        {
            var mods = GetAllMods();
            var (gamePath, bundlePath) = gamePathManager.GetGamePaths();

            // TODO: Implement mod application logic (would involve CRC patching)
            Console.WriteLine($"Applying {selectedModIds.Count} mods to {bundlePath}");
        }

        public void UninstallMods(List<string> selectedModIds, GamePathManager gamePathManager)
        {
            var (gamePath, bundlePath) = gamePathManager.GetGamePaths();

            // TODO: Implement mod uninstall logic
            Console.WriteLine($"Uninstalling {selectedModIds.Count} mods from {bundlePath}");
        }
    }
}
