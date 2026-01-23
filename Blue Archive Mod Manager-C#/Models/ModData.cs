using System;
using System.Collections.Generic;

namespace Blue_Archive_Mod_Manager_C_.Models
{
    public class ModData
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string FileName { get; set; }
        public string ActualFileName { get; set; }
        public string ModName { get; set; }
        public bool Enabled { get; set; }
        public string Path { get; set; }
        public string InstalledDate { get; set; } = DateTime.UtcNow.ToString("O");
        public string Character { get; set; }
        public string CharacterId { get; set; }
        public string CharacterDev { get; set; }
        public string LastLanguage { get; set; }
    }

    public class GamePathConfig
    {
        public string GamePath { get; set; }
        public string GameBundlePath { get; set; }
        public string Language { get; set; } = "en";
        public string Theme { get; set; } = "light";
    }

    public class StudentCharacterInfo
    {
        public string DevName { get; set; }
        public string Name { get; set; }
        public string Id { get; set; }
    }
}
