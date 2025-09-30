# cli.py
import argparse
import os
import sys
from pathlib import Path
import logging

# 将项目根目录添加到 sys.path，以便可以导入 processing 和 utils
sys.path.append(str(Path(__file__).parent.absolute()))

try:
    import processing
    from utils import Logger
except ImportError as e:
    print(f"错误: 无法导入必要的模块: {e}")
    print("请确保 'processing.py' 和 'utils.py' 文件与此脚本位于同一目录中。")
    sys.exit(1)

# --- 日志设置 ---
# 创建一个简单的控制台日志记录器，代替GUI中的Logger
def setup_cli_logger():
    """配置一个简单的日志记录器，将日志输出到控制台。"""
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
            log.info(f"状态: {message}")
        def clear(self):
            # 在CLI中，我们通常不清除屏幕，所以这个方法什么都不做
            pass
            
    return CLILogger()

# --- 命令处理函数 ---

def handle_update(args, logger):
    """处理 'update' 命令的逻辑。"""
    logger.log("--- 开始一键更新 Mod (CLI) ---")

    old_mod_path = Path(args.old_mod)
    output_dir = Path(args.output_dir)
    
    # 确保输出目录存在
    output_dir.mkdir(parents=True, exist_ok=True)

    new_bundle_path = None
    if args.new_bundle:
        new_bundle_path = Path(args.new_bundle)
    elif args.game_dir:
        logger.log(f"未提供新版资源文件，将在 '{args.game_dir}' 中自动搜索...")
        game_dir = Path(args.game_dir)
        if not game_dir.is_dir():
            logger.log(f"❌ 错误: 游戏资源目录 '{game_dir}' 不存在或不是一个目录。")
            return
        
        found_path, message = processing.find_new_bundle_path(old_mod_path, game_dir, logger.log)
        if not found_path:
            logger.log(f"❌ 自动搜索失败: {message}")
            return
        new_bundle_path = found_path
    
    if not new_bundle_path:
        logger.log("❌ 错误: 必须提供 '--new-bundle' 或 '--game-dir' 以确定目标资源文件。")
        return

    asset_types = set(args.asset_types)
    logger.log(f"指定的资源替换类型: {', '.join(asset_types)}")

    # 调用核心处理函数
    success, message = processing.process_mod_update(
        old_mod_path=old_mod_path,
        new_bundle_path=new_bundle_path,
        working_dir=output_dir,
        log=logger.log,
        asset_types_to_replace=asset_types
    )

    logger.log("\n" + "="*50)
    if success:
        logger.log(f"✅ 操作成功: {message}")
    else:
        logger.log(f"❌ 操作失败: {message}")


def handle_replace_png(args, logger):
    """处理 'replace-png' 命令的逻辑。"""
    logger.log("--- 开始 PNG 替换 (CLI) ---")
    
    bundle_path = Path(args.bundle)
    image_folder = Path(args.image_folder)
    output_dir = Path(args.output_dir)

    # 确保输出目录存在
    output_dir.mkdir(parents=True, exist_ok=True)

    if not bundle_path.is_file():
        logger.log(f"❌ 错误: Bundle 文件 '{bundle_path}' 不存在。")
        return
    if not image_folder.is_dir():
        logger.log(f"❌ 错误: 图片文件夹 '{image_folder}' 不存在。")
        return

    # 调用核心处理函数
    success, message = processing.process_png_replacement(
        target_bundle_path=bundle_path,
        image_folder=image_folder,
        working_dir=output_dir,
        log=logger.log
    )

    logger.log("\n" + "="*50)
    if success:
        logger.log(f"✅ 操作成功: {message}")
    else:
        logger.log(f"❌ 操作失败: {message}")


def main():
    """主函数，用于解析命令行参数并分派任务。"""
    parser = argparse.ArgumentParser(
        description="BA Modding Toolkit - Command Line Interface.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    subparsers = parser.add_subparsers(dest='command', required=True, help='可用的命令')

    # --- 'update' 命令 ---
    update_parser = subparsers.add_parser(
        'update', 
        help='一键更新 Mod，将旧 Mod 的资源移植到新版游戏文件中。',
        description='''
示例:
  # 自动搜索新文件并更新
  python maincli.py update --old-mod "C:\\path\\to\\old_mod.bundle" --game-dir "C:\\path\\to\\game_data" --output-dir "C:\\path\\to\\output"

  # 手动指定新文件并更新
  python maincli.py update --old-mod "C:\\path\\to\\old_mod.bundle" --new-bundle "C:\\path\\to\\new_game_file.bundle" --output-dir "C:\\path\\to\\output"

  # 指定替换多种资源
  python maincli.py update --old-mod "..." --new-bundle "..." --output-dir "..." --asset-types Texture2D TextAsset
'''
    )
    update_parser.add_argument('--old-mod', required=True, help='旧版 Mod bundle 文件的路径。')
    update_parser.add_argument('--new-bundle', help='新版游戏资源 bundle 文件的路径 (如果提供，则优先于 --game-dir)。')
    update_parser.add_argument('--game-dir', help='游戏资源目录的路径，用于自动查找匹配的新版 bundle 文件。')
    update_parser.add_argument('--output-dir', required=True, help='保存生成的新 Mod 文件的目录。')
    update_parser.add_argument(
        '--asset-types', 
        nargs='+', 
        default=['Texture2D'], 
        choices=['Texture2D', 'TextAsset', 'Mesh'],
        help='要替换的资源类型列表 (默认为: Texture2D)。'
    )

    # --- 'replace-png' 命令 ---
    replace_parser = subparsers.add_parser(
        'replace-png', 
        help='将 PNG 图片文件夹中的内容替换到目标 bundle 文件中。',
        description='''
示例:
  python maincli.py replace-png --bundle "C:\\path\\to\\target.bundle" --image-folder "C:\\path\\to\\images" --output-dir "C:\\path\\to\\output"
'''
    )
    replace_parser.add_argument('--bundle', required=True, help='要修改的目标 bundle 文件路径。')
    replace_parser.add_argument('--image-folder', required=True, help='包含 .png 图片的文件夹路径。图片文件名 (不含扩展名) 需与 bundle 内资源名匹配。')
    replace_parser.add_argument('--output-dir', required=True, help='保存修改后 bundle 文件的目录。')

    args = parser.parse_args()
    
    # 初始化日志记录器
    logger = setup_cli_logger()

    # 根据命令调用相应的处理函数
    if args.command == 'update':
        handle_update(args, logger)
    elif args.command == 'replace-png':
        handle_replace_png(args, logger)

if __name__ == "__main__":
    main()
