using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Blue_Archive_Mod_Manager_C_.Models;
using Blue_Archive_Mod_Manager_C_.Models.Media.Service;
using Blue_Archive_Mod_Manager_C_.Utils;
using MemoryPack;

namespace Blue_Archive_Mod_Manager_C_.Modules
{
    public class CatalogManager
    {
        private readonly GamePathManager _gamePathManager;
        private readonly SettingsManager _settingsManager;

        public CatalogManager(GamePathManager gamePathManager, SettingsManager settingsManager)
        {
            _gamePathManager = gamePathManager;
            _settingsManager = settingsManager;
        }

        public async Task<string> ExportCatalogJsonAsync(string region)
        {
            if (region.ToLower() != "jp")
            {
                throw new InvalidOperationException("This feature is only available for JP server.");
            }

            var (gamePath, bundlePath) = _gamePathManager.GetGamePaths();
            // Note: gamePath usually points to .exe. bundlePath points to BlueArchive_Data.
            
            // Re-verify paths if necessary, but we rely on what's passed or stored.
            // User example: C:\YostarGames\BlueArchive_JP\BlueArchive_Data\StreamingAssets\TableBundles\Catalog\TableCatalog.bytes
            
            if (string.IsNullOrEmpty(bundlePath))
            {
                throw new DirectoryNotFoundException("Game bundle path is not set.");
            }

            var tableCatalogPath = Path.Combine(bundlePath, "StreamingAssets", "TableBundles", "Catalog", "TableCatalog.bytes");
            var mediaCatalogPath = Path.Combine(bundlePath, "StreamingAssets", "MediaPatch", "Catalog", "MediaCatalog.bytes");
            // Sometimes it might not be inside Catalog.bytes folder? User said: ...\MediaPatch\Catalog.bytes\MediaCatalog.bytes
            // Let's trust the user pattern.

            if (!File.Exists(tableCatalogPath))
            {
                 // Try fallback?
            }

            var exportDir = Path.Combine(_settingsManager.GetAppDataPath(), "Exports");
            Directory.CreateDirectory(exportDir);

            var tableJsonPath = Path.Combine(exportDir, "TableCatalog.json");
            var mediaJsonPath = Path.Combine(exportDir, "MediaCatalog.json");

            // Process TableCatalog
            if (File.Exists(tableCatalogPath))
            {
                var bytes = await File.ReadAllBytesAsync(tableCatalogPath);
                var catalog = MemoryPackSerializer.Deserialize<TableCatalog>(bytes);
                var json = JsonSerializer.Serialize(catalog, new JsonSerializerOptions { WriteIndented = true });
                await File.WriteAllTextAsync(tableJsonPath, json);
            }
            else
            {
                return $"Error: TableCatalog.bytes not found at {tableCatalogPath}";
            }

            // Process MediaCatalog
            if (File.Exists(mediaCatalogPath))
            {
                var bytes = await File.ReadAllBytesAsync(mediaCatalogPath);
                var catalog = MemoryPackSerializer.Deserialize<MediaCatalog>(bytes);
                var json = JsonSerializer.Serialize(catalog, new JsonSerializerOptions { WriteIndented = true });
                await File.WriteAllTextAsync(mediaJsonPath, json);
            }
            else
            {
                 // Try looking in parent just in case path structure slightly differs
                 var altPath = Path.Combine(bundlePath, "StreamingAssets", "MediaPatch", "MediaCatalog.bytes");
                 if (File.Exists(altPath))
                 {
                    var bytes = await File.ReadAllBytesAsync(altPath);
                    var catalog = MemoryPackSerializer.Deserialize<MediaCatalog>(bytes);
                    var json = JsonSerializer.Serialize(catalog, new JsonSerializerOptions { WriteIndented = true });
                    await File.WriteAllTextAsync(mediaJsonPath, json);
                 }
                 else
                 {
                     return $"Error: MediaCatalog.bytes not found at {mediaCatalogPath}";
                 }
            }

            return exportDir;
        }

        public async Task<string> ExportMappingJsonAsync(string region)
        {
            if (region.ToLowerInvariant() != "jp")
            {
                throw new InvalidOperationException("This feature is only available for JP server.");
            }

            var (_, bundlePath) = _gamePathManager.GetGamePaths();
            if (string.IsNullOrEmpty(bundlePath)) throw new DirectoryNotFoundException("Game bundle path is not set.");

            var mapping = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            var tableCatalogPaths = new[]
            {
                Path.Combine(bundlePath, "StreamingAssets", "TableBundles", "Catalog", "TableCatalog.bytes"),
                Path.Combine(bundlePath, "StreamingAssets", "TableBundles", "Catalog.bytes", "TableCatalog.bytes"),
                Path.Combine(bundlePath, "StreamingAssets", "Catalog", "TableCatalog.bytes")
            };

            var tableLookup = await LoadTableLookupAsync(tableCatalogPaths);
            if (tableLookup.Count == 0)
            {
                return "Error: 無法讀取 TableCatalog.bytes，請確認路徑是否正確。";
            }

            var tableDirs = new List<string>();
            AddDirectoryIfExists(tableDirs, Path.Combine(bundlePath, "StreamingAssets", "TableBundles"));
            AddDirectoryIfExists(tableDirs, Path.Combine(bundlePath, "StreamingAssets", "TableBundles", "Catalog"));
            AddDirectoryIfExists(tableDirs, Path.Combine(bundlePath, "StreamingAssets", "TableBundles", "Catalog.bytes"));

            PopulateMappingsFromDirectories(tableDirs, tableLookup, mapping);

            var mediaCatalogPaths = new[]
            {
                Path.Combine(bundlePath, "StreamingAssets", "MediaPatch", "Catalog", "MediaCatalog.bytes"),
                Path.Combine(bundlePath, "StreamingAssets", "MediaPatch", "Catalog.bytes", "MediaCatalog.bytes")
            };

            var mediaLookup = await LoadMediaLookupAsync(mediaCatalogPaths);
            if (mediaLookup.Count == 0)
            {
                return "Error: 無法讀取 MediaCatalog.bytes，請確認路徑是否正確。";
            }

            var mediaDirs = new List<string>();
            AddDirectoryIfExists(mediaDirs, Path.Combine(bundlePath, "StreamingAssets", "MediaPatch"));
            AddDirectoryIfExists(mediaDirs, Path.Combine(bundlePath, "StreamingAssets", "MediaPatch", "Catalog"));
            AddDirectoryIfExists(mediaDirs, Path.Combine(bundlePath, "StreamingAssets", "MediaPatch", "Catalog.bytes"));

            PopulateMappingsFromDirectories(mediaDirs, mediaLookup, mapping);

            if (mapping.Count == 0)
            {
                return "Error: 找不到任何實際檔案與 CRC 對應，請確認 TableBundles 與 MediaPatch 內有下載完成的檔案。";
            }

            var exportDir = Path.Combine(_settingsManager.GetAppDataPath(), "Exports");
            Directory.CreateDirectory(exportDir);
            var mappingJsonPath = Path.Combine(exportDir, "Mapping.json");

            var json = JsonSerializer.Serialize(mapping, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(mappingJsonPath, json);

            return exportDir;
        }

        private static async Task<Dictionary<long, string>> LoadTableLookupAsync(IEnumerable<string> catalogPaths)
        {
            var lookup = new Dictionary<long, string>();

            foreach (var path in catalogPaths)
            {
                if (!File.Exists(path)) continue;

                var bytes = await File.ReadAllBytesAsync(path);
                var catalog = MemoryPackSerializer.Deserialize<TableCatalog>(bytes);
                if (catalog?.Table == null) continue;

                foreach (var bundle in catalog.Table.Values)
                {
                    if (bundle == null) continue;
                    if (!lookup.ContainsKey(bundle.Crc))
                    {
                        lookup[bundle.Crc] = bundle.Name;
                    }
                }

                break;
            }

            return lookup;
        }

        private static async Task<Dictionary<long, string>> LoadMediaLookupAsync(IEnumerable<string> catalogPaths)
        {
            var lookup = new Dictionary<long, string>();

            foreach (var path in catalogPaths)
            {
                if (!File.Exists(path)) continue;

                var bytes = await File.ReadAllBytesAsync(path);
                var catalog = MemoryPackSerializer.Deserialize<MediaCatalog>(bytes);
                if (catalog?.Table == null) continue;

                foreach (var media in catalog.Table.Values)
                {
                    if (media == null) continue;
                    var resolved = string.IsNullOrWhiteSpace(media.FileName) ? media.Path : media.FileName;
                    if (string.IsNullOrWhiteSpace(resolved)) continue;

                    if (!lookup.ContainsKey(media.Crc))
                    {
                        lookup[media.Crc] = resolved;
                    }
                }

                break;
            }

            return lookup;
        }

        private static void AddDirectoryIfExists(List<string> directories, string path)
        {
            if (!string.IsNullOrEmpty(path) && Directory.Exists(path) && !directories.Contains(path))
            {
                directories.Add(path);
            }
        }

        private static void PopulateMappingsFromDirectories(IEnumerable<string> directories, IReadOnlyDictionary<long, string> crcLookup, IDictionary<string, string> mapping)
        {
            foreach (var directory in directories)
            {
                if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory)) continue;

                foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories))
                {
                    var fileName = Path.GetFileName(file);
                    if (!TryExtractCrcFromFileName(fileName, out var crc)) continue;
                    if (!crcLookup.TryGetValue(crc, out var originalName)) continue;

                    if (!mapping.ContainsKey(fileName))
                    {
                        mapping[fileName] = originalName;
                    }
                }
            }
        }

        private static bool TryExtractCrcFromFileName(string fileName, out long crc)
        {
            crc = 0;
            if (string.IsNullOrWhiteSpace(fileName)) return false;

            var nameWithoutExtension = Path.GetFileNameWithoutExtension(fileName);
            var separatorIndex = nameWithoutExtension.LastIndexOf('_');
            if (separatorIndex < 0 || separatorIndex == nameWithoutExtension.Length - 1) return false;

            var crcSegment = nameWithoutExtension[(separatorIndex + 1)..];
            return long.TryParse(crcSegment, NumberStyles.Integer, CultureInfo.InvariantCulture, out crc);
        }
    }
}

