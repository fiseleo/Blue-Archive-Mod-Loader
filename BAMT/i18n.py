# BAMT/i18n.py
import json
import os
from pathlib import Path

_translations = {}
_current_locale = 'en'

def load_translations(locales_dir: str, locale: str):
    """
    根據給定的語言環境加載翻譯文件。
    """
    global _translations, _current_locale
    _current_locale = locale
    
    try:
        # 确保 locales_dir 是一个 Path 对象
        locales_path = Path(locales_dir)
        translation_file = locales_path / locale / 'translation.json'

        if not translation_file.exists():
            # 如果特定語言文件不存在，嘗試使用 'en' 作為備用
            locale_short = locale.split('-')[0]
            translation_file = locales_path / locale_short / 'translation.json'
            if translation_file.exists():
                _current_locale = locale_short
            else:
                translation_file = locales_path / 'en' / 'translation.json'
                _current_locale = 'en'

        with open(translation_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # 將巢狀的 JSON 扁平化為單層字典
            _translations = _flatten_json(data)

    except Exception as e:
        # 如果加載失敗，保持 _translations 為空字典
        _translations = {}
        print(f"Error loading translation file for locale '{locale}': {e}")


def _flatten_json(y):
    """將巢狀的 JSON 物件扁平化。"""
    out = {}

    def flatten(x, name=''):
        if type(x) is dict:
            for a in x:
                flatten(x[a], name + a + '.')
        elif type(x) is list:
            i = 0
            for a in x:
                flatten(a, name + str(i) + '.')
                i += 1
        else:
            out[name[:-1]] = x

    flatten(y)
    return out

def t(key: str, **kwargs):
    """
    根據鍵值獲取翻譯文本，並替換佔位符。
    """
    # 從扁平化的字典中獲取翻譯
    template = _translations.get(key, key)
    
    # 替換佔位符，例如 {{name}}
    try:
        return template.format(**kwargs)
    except (KeyError, TypeError):
        # 如果 format 失敗，返回原始模板
        return template
