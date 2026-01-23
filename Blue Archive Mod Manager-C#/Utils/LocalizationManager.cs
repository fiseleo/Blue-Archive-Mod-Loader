using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace Blue_Archive_Mod_Manager_C_.Utils
{
    public class LocalizationManager
    {
        private Dictionary<string, Dictionary<string, string>> _translations = new();
        private string _currentLocale = "en";

        public LocalizationManager()
        {
            LoadLocales();
        }

        private void LoadLocales()
        {
            var localesPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Locales");
            
            if (!Directory.Exists(localesPath))
            {
                // Create default locales
                CreateDefaultLocales(localesPath);
            }

            var localeFiles = Directory.GetFiles(localesPath, "*.json");
            foreach (var file in localeFiles)
            {
                try
                {
                    var locale = Path.GetFileNameWithoutExtension(file);
                    var content = File.ReadAllText(file);
                    var dict = JsonSerializer.Deserialize<Dictionary<string, string>>(content);
                    if (dict != null)
                    {
                        _translations[locale] = dict;
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Error loading locale {file}: {ex.Message}");
                }
            }
        }

        public void SetLocale(string locale)
        {
            if (_translations.ContainsKey(locale))
            {
                _currentLocale = locale;
            }
            else
            {
                _currentLocale = "en";
            }
        }

        public string T(string key, Dictionary<string, string>? parameters = null)
        {
            string value = key;

            // Try current locale
            if (_translations.TryGetValue(_currentLocale, out var dict) && dict.TryGetValue(key, out var localized))
            {
                value = localized;
            }
            // Fallback to English
            else if (_translations.TryGetValue("en", out var engDict) && engDict.TryGetValue(key, out var engLocalized))
            {
                value = engLocalized;
            }

            // Replace parameters
            if (parameters != null)
            {
                foreach (var param in parameters)
                {
                    value = value.Replace($"{{{{{param.Key}}}}}", param.Value);
                }
            }

            return value;
        }

        private void CreateDefaultLocales(string localesPath)
        {
            Directory.CreateDirectory(localesPath);

            var enLocale = new Dictionary<string, string>
            {
                { "title", "Blue Archive Mod Loader" },
                { "select_file_button", "Select File" },
                { "select_all_button", "Select All" },
                { "set_game_path_button", "Set Game Path" },
                { "game_path_label", "Game Path" },
                { "game_bundle_path_label", "Game Bundle Path" },
                { "game_path_not_set", "Game path not set" },
                { "mod_management_title", "Mod Management" },
                { "game_info_title", "Game Info" },
                { "apply_mods_button", "Apply Mods" },
                { "uninstall_mods_button", "Uninstall Mods" },
                { "launch_game_button", "Launch Game" },
                { "mod_table_header_enabled", "Enabled" },
                { "mod_table_header_filename", "Filename" },
                { "mod_table_header_character", "Character" },
                { "mod_table_header_modname", "Mod Name" },
                { "mod_table_header_date", "Date" },
                { "mod_table_header_actions", "Actions" },
                { "toggle_theme", "Toggle Theme" },
                { "loading", "Loading..." },
                { "status_finding_steam", "Finding Steam..." },
                { "status_steam_found", "Steam found at: {{path}}" },
                { "status_checking_steam_library", "Checking library: {{library}}" },
                { "status_found_steam", "Game found at: {{path}}" },
                { "status_steam_not_found_fallback", "Game not found in Steam" },
                { "status_found", "Game found: {{path}}" },
                { "status_not_found", "Game not found" },
                { "status_preparing_search", "Preparing search..." },
                { "status_drives_found", "Drives found: {{drives}}" },
                { "status_scanning_drive", "Scanning: {{drive}}" }
            };

            File.WriteAllText(Path.Combine(localesPath, "en.json"), JsonSerializer.Serialize(enLocale, new JsonSerializerOptions { WriteIndented = true }));
        }
    }
}
