using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Blue_Archive_Mod_Manager_C_.Utils;
using Blue_Archive_Mod_Manager_C_.Models;

namespace Blue_Archive_Mod_Manager_C_.Modules
{
    public class StudentIndexManager
    {
        private readonly string _indexPath;
        private Dictionary<string, object> _studentIndex;

        public StudentIndexManager(SettingsManager settingsManager)
        {
            _indexPath = Path.Combine(settingsManager.GetAppDataPath(), "student-index.json");
            LoadStudentIndex();
        }

        private void LoadStudentIndex()
        {
            try
            {
                if (File.Exists(_indexPath))
                {
                    var json = File.ReadAllText(_indexPath);
                    _studentIndex = JsonSerializer.Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>();
                    Console.WriteLine($"Student index loaded from: {_indexPath}");
                }
                else
                {
                    Console.WriteLine("Student index not found. Will create new index.");
                    _studentIndex = new Dictionary<string, object>();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Failed to load student index: {ex.Message}");
                _studentIndex = new Dictionary<string, object>();
            }
        }

        public StudentCharacterInfo ExtractCharacterInfo(string filename, string locale = "en")
        {
            if (string.IsNullOrEmpty(filename) || _studentIndex == null || _studentIndex.Count == 0)
            {
                return null;
            }

            var lowerFilename = filename.ToLower();

            // First search: look for devName in filename (exact match like CH0233)
            foreach (var kvp in _studentIndex)
            {
                var devName = kvp.Key.ToLower();
                if (lowerFilename.Contains(devName))
                {
                    try
                    {
                        if (kvp.Value is JsonElement je)
                        {
                            var data = JsonSerializer.Deserialize<Dictionary<string, object>>(je.GetRawText());
                            if (data != null)
                            {
                                var name = ExtractLocalizedName(data, locale);
                                return new StudentCharacterInfo
                                {
                                    DevName = kvp.Key,
                                    Name = name ?? devName,
                                    Id = data.ContainsKey("id") ? data["id"].ToString() : null
                                };
                            }
                        }
                    }
                    catch { }
                }
            }

            // Second search: look for character names in all languages
            foreach (var kvp in _studentIndex)
            {
                try
                {
                    if (kvp.Value is JsonElement je)
                    {
                        var data = JsonSerializer.Deserialize<Dictionary<string, object>>(je.GetRawText());
                        if (data != null && data.ContainsKey("names"))
                        {
                            var namesElement = data["names"];
                            if (namesElement is JsonElement namesJson)
                            {
                                var names = JsonSerializer.Deserialize<Dictionary<string, string>>(namesJson.GetRawText());
                                if (names != null)
                                {
                                    foreach (var nameEntry in names.Values)
                                    {
                                        if (!string.IsNullOrEmpty(nameEntry) && lowerFilename.Contains(nameEntry.ToLower()))
                                        {
                                            var name = ExtractLocalizedName(data, locale);
                                            return new StudentCharacterInfo
                                            {
                                                DevName = kvp.Key,
                                                Name = name ?? nameEntry,
                                                Id = data.ContainsKey("id") ? data["id"].ToString() : null
                                            };
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                catch { }
            }

            return null;
        }

        private string ExtractLocalizedName(Dictionary<string, object> characterData, string locale)
        {
            try
            {
                if (characterData.ContainsKey("names"))
                {
                    var namesElement = characterData["names"];
                    if (namesElement is JsonElement namesJson)
                    {
                        var names = JsonSerializer.Deserialize<Dictionary<string, string>>(namesJson.GetRawText());
                        if (names != null && names.ContainsKey(locale))
                        {
                            return names[locale];
                        }
                        if (names != null && names.ContainsKey("en"))
                        {
                            return names["en"];
                        }
                        return names?.Values.FirstOrDefault();
                    }
                }
            }
            catch { }

            return null;
        }

        public Dictionary<string, object> GetStudentIndex()
        {
            return _studentIndex;
        }
    }
}
