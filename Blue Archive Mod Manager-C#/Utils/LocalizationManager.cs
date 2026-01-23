using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Globalization;

namespace Blue_Archive_Mod_Manager_C_.Utils
{
    public class LocalizationManager
    {
        private Dictionary<string, Dictionary<string, string>> _translations = new();
        private string _currentLocale = "en";
        public string CurrentLocale => _currentLocale;

        public LocalizationManager()
        {
            LoadTranslations();
            DetectLocale();
        }

        private void LoadTranslations()
        {
            try
            {
                var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                // Try standard path
                var jsonPath = Path.Combine(baseDir, "Web", "translations.json");
                
                // Fallback for development if not copied to bin
                if (!File.Exists(jsonPath))
                {
                    // Try looking up in project dir
                    var altPath = Path.Combine(baseDir, "..", "..", "..", "Web", "translations.json");
                    if (!File.Exists(altPath))
                    {
                         // Try looking up 2 levels
                         altPath = Path.Combine(baseDir, "..", "..", "Web", "translations.json");
                    }

                    if (File.Exists(altPath))
                    {
                        jsonPath = Path.GetFullPath(altPath);
                    }
                }

                if (File.Exists(jsonPath))
                {
                    var content = File.ReadAllText(jsonPath);
                    _translations = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(content) ?? new();
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error loading translations: {ex.Message}");
            }
        }

        private void DetectLocale()
        {
            var culture = CultureInfo.CurrentUICulture.Name; // e.g. "en-US", "zh-TW", "zh-CN"
            
            if (_translations.ContainsKey(culture))
            {
                _currentLocale = culture;
                return;
            }

            var parent = CultureInfo.CurrentUICulture.Parent.Name;
            if (!string.IsNullOrEmpty(parent) && _translations.ContainsKey(parent))
            {
                 _currentLocale = parent;
                 return;
            }

            if (culture.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
            {
                if (culture.Contains("TW", StringComparison.OrdinalIgnoreCase) || culture.Contains("HK", StringComparison.OrdinalIgnoreCase))
                {
                    if (_translations.ContainsKey("zh-TW")) _currentLocale = "zh-TW";
                    else if (_translations.ContainsKey("zh")) _currentLocale = "zh";
                }
                else
                {
                    if (_translations.ContainsKey("zh")) _currentLocale = "zh";
                    else if (_translations.ContainsKey("zh-TW")) _currentLocale = "zh-TW";
                }
                return;
            }

            if (_translations.ContainsKey("en"))
            {
                _currentLocale = "en";
            }
            else if (_translations.Count > 0)
            {
                // Fallback to first available
                foreach(var key in _translations.Keys) {
                    _currentLocale = key;
                    break;
                }
            }
        }

        public string T(string key, Dictionary<string, string>? parameters = null)
        {
            string value = key;

            if (_translations.TryGetValue(_currentLocale, out var dict) && dict.TryGetValue(key, out var localized))
            {
                value = localized;
            }
            else if (_translations.TryGetValue("en", out var engDict) && engDict.TryGetValue(key, out var engLocalized))
            {
                value = engLocalized;
            }

            if (parameters != null)
            {
                foreach (var param in parameters)
                {
                    value = value.Replace($"{{{{{param.Key}}}}}", param.Value);
                }
            }

            return value;
        }
    }
}
