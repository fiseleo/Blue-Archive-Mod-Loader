# cli.py
import argparse
import json
import os
import sys
from pathlib import Path
import logging


sys.path.append(str(Path(__file__).parent.absolute()))

try:
    import processing
    from utils import Logger
    from i18n import t, load_translations
except ImportError as e:
    print(t('bamt.cli.errormoduleImport', module=e))
    print(t('bamt.cli.errormoduleImportLocation'))
    sys.exit(1)

# --- 日志设置 ---
# 创建一个简单的控制台日志记录器，代替GUI中的Logger
def setup_cli_logger():
    log = logging.getLogger('cli')
    if not log.handlers:
        log.setLevel(logging.INFO)
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter('%(message)s')
        handler.setFormatter(formatter)
        log.addHandler(handler)
    
    # 模拟GUI Logger的接口
    class CLILogger:
        def log(self, message):
            log.info(message)
        def status(self, message):
            log.info(f"state : {message}")
        def clear(self):
            # 在CLI中，我们通常不清除屏幕，所以这个方法什么都不做
            pass
            
    return CLILogger()


def emit_result(status, message, extra=None):
    """輸出給 Electron 端解析的結構化結果。"""

    def _serialize(value):
        if isinstance(value, Path):
            return str(value)
        if isinstance(value, (list, tuple, set)):
            return [_serialize(item) for item in value]
        if isinstance(value, dict):
            return {key: _serialize(val) for key, val in value.items()}
        return value

    payload = {
        'status': status,
        'message': str(message) if message is not None else ''
    }
    if isinstance(extra, dict):
        for key, value in extra.items():
            if value is None:
                continue
            payload[key] = _serialize(value)

    print(f"RESULT:{json.dumps(payload, ensure_ascii=False)}")

# --- 命令处理函数 ---

def handle_update(args, logger):
    
    logger.log(t('bamt.cli.startUpdate'))

    old_mod_path = Path(args.old_mod)
    output_dir = Path(args.output_dir)
    
    
    output_dir.mkdir(parents=True, exist_ok=True)

    new_bundle_path = None
    if args.new_bundle:
        new_bundle_path = Path(args.new_bundle)
    elif args.game_dir:
        logger.log(t('bamt.cli.searchNewBundle', path=args.game_dir))
        game_dir = Path(args.game_dir)
        if not game_dir.is_dir():
            message_text = t('bamt.cli.gameDirError', path=game_dir)
            logger.log(message_text)
            emit_result('error', message_text, {'replaced': 0, 'skipped': 0, 'output': None})
            return
        
        found_path, message = processing.find_new_bundle_path(old_mod_path, game_dir, logger.log)
        if not found_path:
            fail_message = t('bamt.cli.searchFailed', message=message)
            logger.log(fail_message)
            emit_result('error', fail_message, {'replaced': 0, 'skipped': 0, 'output': None})
            return
        new_bundle_path = found_path
    
    if not new_bundle_path:
        message_text = t('bamt.cli.noBundleTarget')
        logger.log(message_text)
        emit_result('error', message_text, {'replaced': 0, 'skipped': 0, 'output': None})
        return

    asset_types = set(args.asset_types)
    logger.log(t('bamt.cli.assetTypes', types=', '.join(asset_types)))

    # 调用核心处理函数
    result_tuple = processing.process_mod_update(
        old_mod_path=old_mod_path,
        new_bundle_path=new_bundle_path,
        working_dir=output_dir,
        log=logger.log,
        asset_types_to_replace=asset_types
    )

    if isinstance(result_tuple, tuple):
        if len(result_tuple) >= 3:
            success, message_obj, meta_extra = result_tuple[0], result_tuple[1], result_tuple[2]
        elif len(result_tuple) == 2:
            success, message_obj = result_tuple
            meta_extra = {}
        else:
            success = result_tuple[0] if result_tuple else False
            message_obj = ''
            meta_extra = {}
    else:
        success = bool(result_tuple)
        message_obj = ''
        meta_extra = {}

    meta_from_message = {}
    if isinstance(message_obj, dict):
        meta_from_message = {k: v for k, v in message_obj.items()}
        message_text = str(meta_from_message.pop('message', '') or '')
    else:
        message_text = str(message_obj or '')

    combined_meta = {}
    combined_meta.update(meta_from_message)
    if isinstance(meta_extra, dict):
        combined_meta.update(meta_extra)

    logger.log("\n" + "="*50)
    if success:
        logger.log(t('bamt.cli.opSuccess', message=message_text))
        emit_result('success', message_text, combined_meta)
    else:
        logger.log(t('bamt.cli.opFailed', message=message_text))
        emit_result('error', message_text, combined_meta)


def handle_replace_png(args, logger):
    """处理 'replace-png' 命令的逻辑。"""
    logger.log(t('bamt.cli.startPngReplace'))
    
    bundle_path = Path(args.bundle)
    image_folder = Path(args.image_folder)
    output_dir = Path(args.output_dir)

    # 确保输出目录存在
    output_dir.mkdir(parents=True, exist_ok=True)

    if not bundle_path.is_file():
        message_text = t('bamt.cli.bundleFileError', path=bundle_path)
        logger.log(message_text)
        emit_result('error', message_text, {'replaced': 0, 'missing': [], 'output': None})
        return
    if not image_folder.is_dir():
        message_text = t('bamt.cli.imageFolderError', path=image_folder)
        logger.log(message_text)
        emit_result('error', message_text, {'replaced': 0, 'missing': [], 'output': None})
        return

    # 调用核心处理函数
    result_tuple = processing.process_png_replacement(
        target_bundle_path=bundle_path,
        image_folder=image_folder,
        working_dir=output_dir,
        log=logger.log
    )

    if isinstance(result_tuple, tuple):
        if len(result_tuple) >= 3:
            success, message_obj, meta_extra = result_tuple[0], result_tuple[1], result_tuple[2]
        elif len(result_tuple) == 2:
            success, message_obj = result_tuple
            meta_extra = {}
        else:
            success = result_tuple[0] if result_tuple else False
            message_obj = ''
            meta_extra = {}
    else:
        success = bool(result_tuple)
        message_obj = ''
        meta_extra = {}

    meta_from_message = {}
    if isinstance(message_obj, dict):
        meta_from_message = {k: v for k, v in message_obj.items()}
        message_text = str(meta_from_message.pop('message', '') or '')
    else:
        message_text = str(message_obj or '')

    combined_meta = {}
    combined_meta.update(meta_from_message)
    if isinstance(meta_extra, dict):
        combined_meta.update(meta_extra)

    logger.log("\n" + "="*50)
    if success:
        logger.log(t('bamt.cli.opSuccess', message=message_text))
        emit_result('success', message_text, combined_meta)
    else:
        logger.log(t('bamt.cli.opFailed', message=message_text))
        emit_result('error', message_text, combined_meta)


def main():
    """主函数，用于解析命令行参数并分派任务。"""
    # 1. 提前解析 --lang 参数
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument('--lang', default='en', help='Language for the interface (e.g., en, zh-CN, zh-TW)')
    # 使用 parse_known_args() 来安全地获取 --lang，忽略其他参数
    args, remaining_argv = pre_parser.parse_known_args()

    # 2. 初始化国际化
    locales_dir = Path(__file__).parent.parent / 'locales'
    load_translations(str(locales_dir), args.lang)
    
    # 3. 现在 t() 函数可用，创建功能完整的解析器
    parser = argparse.ArgumentParser(
        description=t('bamt.cli.description'),
        formatter_class=argparse.RawTextHelpFormatter,
        parents=[pre_parser]  # 包含 --lang 以便在 --help 中显示
    )
    
    subparsers = parser.add_subparsers(dest='command', required=True, help=t('bamt.cli.availableCommands'))

    # --- 'update' 命令 ---
    update_parser = subparsers.add_parser(
        'update', 
        help=t('bamt.cli.updateHelp'),
        description=t('bamt.cli.updateDescription')
    )
    update_parser.add_argument('--old-mod', required=True, help=t('bamt.cli.oldModHelp'))
    update_parser.add_argument('--new-bundle', help=t('bamt.cli.newBundleHelp'))
    update_parser.add_argument('--game-dir', help=t('bamt.cli.gameDirHelp'))
    update_parser.add_argument('--output-dir', required=True, help=t('bamt.cli.outputDirHelp'))
    update_parser.add_argument(
        '--asset-types', 
        nargs='+', 
        default=['Texture2D', 'Mesh'], 
        choices=['Texture2D', 'TextAsset', 'Mesh'],
        help=t('bamt.cli.assetTypesHelp')
    )

    # --- 'replace-png' 命令 ---
    replace_parser = subparsers.add_parser(
        'replace-png', 
        help=t('bamt.cli.replacePngHelp'),
        description=t('bamt.cli.replacePngDescription')
    )
    replace_parser.add_argument('--bundle', required=True, help=t('bamt.cli.bundleHelp'))
    replace_parser.add_argument('--image-folder', required=True, help=t('bamt.cli.imageFolderHelp'))
    replace_parser.add_argument('--output-dir', required=True, help=t('bamt.cli.outputDirHelpPng'))

    # 4. 解析余下的参数
    # `namespace=args` 确保将新解析的参数添加到已包含 --lang 的 args 对象中
    parser.parse_args(remaining_argv, namespace=args)
    
    # 5. 初始化日志记录器并执行命令
    logger = setup_cli_logger()

    if args.command == 'update':
        handle_update(args, logger)
    elif args.command == 'replace-png':
        handle_replace_png(args, logger)

if __name__ == "__main__":
    main()
