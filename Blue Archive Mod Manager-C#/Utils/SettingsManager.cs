using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Linq;

namespace Blue_Archive_Mod_Manager_C_.Utils
{
    public class SettingsManager
    {
        private readonly string _settingsPath;
        private Dictionary<string, object> _settings;

        public SettingsManager()
        {
            var appDataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "blue-archive-mod-loader");
            Directory.CreateDirectory(appDataPath);
            _settingsPath = Path.Combine(appDataPath, "settings.json");
            LoadSettings();
        }

        private void LoadSettings()
        {
            if (File.Exists(_settingsPath))
            {
                try
                {
                    var json = File.ReadAllText(_settingsPath);
                    _settings = JsonSerializer.Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>();
                }
                catch
                {
                    _settings = new Dictionary<string, object>();
                }
            }
            else
            {
                _settings = new Dictionary<string, object>();
            }
        }

        public T Get<T>(string key, T defaultValue = default)
        {
            if (_settings.TryGetValue(key, out var value))
            {
                if (value is JsonElement je)
                {
                    return JsonSerializer.Deserialize<T>(je.GetRawText()) ?? defaultValue;
                }
                return (T)Convert.ChangeType(value, typeof(T));
            }
            return defaultValue;
        }

        public void Set(string key, object value)
        {
            _settings[key] = value;
            SaveSettings();
        }

        public void Set(Dictionary<string, object> values)
        {
            foreach (var kvp in values)
            {
                _settings[kvp.Key] = kvp.Value;
            }
            SaveSettings();
        }

        private void SaveSettings()
        {
            try
            {
                var json = JsonSerializer.Serialize(_settings, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_settingsPath, json);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Failed to save settings: {ex.Message}");
            }
        }

        public string GetAppDataPath()
        {
            return Path.GetDirectoryName(_settingsPath);
        }
    }
}
