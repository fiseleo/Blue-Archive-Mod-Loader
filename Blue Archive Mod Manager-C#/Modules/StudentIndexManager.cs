using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Net.Http;
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
            var mappedLocale = MapLocale(locale);
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
                                var name = ExtractLocalizedName(data, mappedLocale);
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
                                            var name = ExtractLocalizedName(data, mappedLocale);
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

        public string? GetCharacterName(string devName, string locale = "en")
        {
            if (string.IsNullOrEmpty(devName)) return null;
            var mappedLocale = MapLocale(locale);

            // key in index is usually lowercase devName (e.g. "aru")
            var key = devName.ToLower();

            if (_studentIndex != null && _studentIndex.TryGetValue(key, out var value))
            {
                 if (value is JsonElement je)
                 {
                     try
                     {
                         var data = JsonSerializer.Deserialize<Dictionary<string, object>>(je.GetRawText());
                         if (data != null)
                         {
                             return ExtractLocalizedName(data, mappedLocale);
                         }
                     }
                     catch { }
                 }
            }
            return null;
        }

        private string MapLocale(string locale)
        {
            if (string.IsNullOrEmpty(locale)) return "en";
            
            // Map standard locales to SchaleDB locales
            locale = locale.ToLower();
            if (locale == "zh-tw" || locale == "zh_tw") return "tw";
            if (locale == "zh-cn" || locale == "zh_cn" || locale == "zh") return "cn";
            if (locale == "ja-jp" || locale == "ja") return "jp";
            if (locale == "ko-kr" || locale == "ko") return "kr";
            if (locale == "th-th" || locale == "th") return "th";
            if (locale == "vi-vn" || locale == "vi") return "vi";
            
            return "en";
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
                        // Try mapped locale directly
                        if (names != null && names.ContainsKey(locale))
                        {
                            return names[locale];
                        }
                        // Try mapping if not already mapped (though we map before calling this usually)
                        var mapped = MapLocale(locale);
                        if (names != null && names.ContainsKey(mapped))
                        {
                            return names[mapped];
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

        public async Task InitializeIndexAsync()
        {
            await CreateStudentIndexAsync();
            LoadStudentIndex();
        }

        private async Task CreateStudentIndexAsync()
        {
            Console.WriteLine("Creating Blue Archive Student Index...");
            
            var dataUrls = new Dictionary<string, string> {
                { "en", "https://schaledb.com/data/en/students.json" },
                { "tw", "https://schaledb.com/data/tw/students.json" },
                { "cn", "https://schaledb.com/data/cn/students.json" }
            };

            try 
            {
                using var client = new HttpClient();
                
                var enTask = client.GetStringAsync(dataUrls["en"]);
                var twTask = client.GetStringAsync(dataUrls["tw"]);
                var cnTask = client.GetStringAsync(dataUrls["cn"]);
                
                await Task.WhenAll(enTask, twTask, cnTask);
                
                var enData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(enTask.Result);
                var twData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(twTask.Result);
                var cnData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(cnTask.Result);

                if (enData == null) return;

                var studentIndex = new Dictionary<string, object>();

                foreach (var kvp in enData)
                {
                    var studentId = kvp.Key;
                    var studentData = kvp.Value;
                    
                    if (studentData.TryGetProperty("DevName", out var devNameProp))
                    {
                        var devName = devNameProp.GetString();
                        if (string.IsNullOrEmpty(devName)) continue;
                        
                        var enName = studentData.GetProperty("Name").GetString();
                        
                        string twName = enName;
                        if (twData != null && twData.TryGetValue(studentId, out var twStudent))
                            if (twStudent.TryGetProperty("Name", out var twNameProp))
                                twName = twNameProp.GetString() ?? enName;
                            
                        string cnName = enName;
                        if (cnData != null && cnData.TryGetValue(studentId, out var cnStudent))
                            if (cnStudent.TryGetProperty("Name", out var cnNameProp))
                                cnName = cnNameProp.GetString() ?? enName;

                        var entry = new {
                            devName = devName,
                            names = new {
                                en = enName,
                                tw = twName,
                                cn = cnName
                            },
                            id = studentId
                        };
                        
                        studentIndex[devName.ToLower()] = entry;
                    }
                }

                // Save
                var dir = Path.GetDirectoryName(_indexPath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                
                var options = new JsonSerializerOptions { WriteIndented = true };
                var jsonOutput = JsonSerializer.Serialize(studentIndex, options);
                
                await File.WriteAllTextAsync(_indexPath, jsonOutput);
                Console.WriteLine($"Student index created successfully! Total students: {studentIndex.Count}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error creating student index: {ex.Message}");
            }
        }

        public Dictionary<string, object> GetStudentIndex()
        {
            return _studentIndex;
        }
    }
}
