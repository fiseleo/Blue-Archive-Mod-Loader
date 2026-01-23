# processing.py

import UnityPy
import os
import traceback
from pathlib import Path
from PIL import Image
import shutil
import re
from i18n import t

def load_bundle(bundle_path: Path, log):
    """
    尝试加载一个 Unity bundle 文件。
    如果直接加载失败，会尝试移除末尾的几个字节后再次加载。
    """
    log(t('bamt.processing.loadingBundle', name=bundle_path.name))

    # 1. 尝试直接加载
    try:
        log(t('bamt.processing.tryDirectLoad'))
        env = UnityPy.load(str(bundle_path))
        log(t('bamt.processing.directLoadSuccess'))
        return env
    except Exception as e:
        if 'insufficient space' in str(e):
            log(t('bamt.processing.directLoadFailedCRC'))
        else:
            log(t('bamt.processing.directLoadFailed', error=e))

    # 如果直接加载失败，读取文件内容到内存
    try:
        with open(bundle_path, "rb") as f:
            data = f.read()
    except Exception as e:
        log(t('bamt.processing.fileReadError', name=bundle_path.name, error=e))
        return None

    # 定义加载策略：字节移除数量
    bytes_to_remove = [4, 8, 12]

    # 2. 依次尝试不同的加载策略
    for bytes_num in bytes_to_remove:
        if len(data) > bytes_num:
            try:
                log(t('bamt.processing.tryRemoveBytes', num=bytes_num))
                trimmed_data = data[:-bytes_num]
                env = UnityPy.load(trimmed_data)
                log(t('bamt.processing.removeBytesSuccess'))
                return env
            except Exception as e:
                log(t('bamt.processing.removeBytesFailed', num=bytes_num, error=e))
        else:
            log(t('bamt.processing.fileTooSmall', num=bytes_num))

    log(t('bamt.processing.loadFailed', name=bundle_path.name))
    return None

def create_backup(original_path: Path, log, backup_mode: str = "default") -> bool:
    """
    创建原始文件的备份
    backup_mode: "default" - 在原文件后缀后添加.bak
                 "b2b" - 重命名为orig_(原名)
    """
    try:
        if backup_mode == "b2b":
            backup_path = original_path.with_name(f"orig_{original_path.name}")
        else:
            backup_path = original_path.with_suffix(original_path.suffix + '.bak')
        
        log(t('bamt.processing.creatingBackup', path=backup_path.name))
        shutil.copy2(original_path, backup_path)
        log(t('bamt.processing.backupCreated'))
        return True
    except Exception as e:
        log(t('bamt.processing.backupFailed', error=e))
        return False

def save_bundle(env: UnityPy.Environment, output_path: Path, log) -> bool:
    """
    将修改后的 Unity bundle 保存到指定路径。
    """
    try:
        log(t('bamt.processing.savingBundle', path=output_path.name))
        log(t('bamt.processing.savingCompressing'))
        
        with open(output_path, "wb") as f:
            f.write(env.file.save(packer="lzma"))
        
        log(t('bamt.processing.saveSuccess', path=output_path))
        return True
    except Exception as e:
        log(t('bamt.processing.saveFailed', path=output_path, error=e))
        log(traceback.format_exc())
        return False

def process_png_replacement(target_bundle_path: Path, image_folder: Path, working_dir: Path, log):
    """
    从PNG文件夹替换贴图。
    此函数将生成的文件保存在工作目录中，以便后续进行"覆盖原文件"操作。
    """
    try:
        replacement_count = 0
        missing_assets = []
        final_path = None
        env = load_bundle(target_bundle_path, log)
        if not env:
            return False, t('bamt.processing.png.loadFailed'), {
                "replaced": 0,
                "missing": [],
                "output": None,
            }
        
        replacement_tasks = []
        image_files = [f for f in os.listdir(image_folder) if f.lower().endswith(".png")]

        if not image_files:
            log(t('bamt.processing.png.noPngFilesWarning'))
            return False, t('bamt.processing.png.noPngFilesError'), {
                "replaced": 0,
                "missing": [],
                "output": None,
            }

        for filename in image_files:
            asset_name = os.path.splitext(filename)[0]
            full_image_path = os.path.join(image_folder, filename)
            replacement_tasks.append((asset_name, full_image_path))

        log(t('bamt.processing.png.scanning'))
        original_tasks_count = len(replacement_tasks)

        for obj in env.objects:
            if obj.type.name == "Texture2D":
                data = obj.read()
                task_to_remove = None
                for asset_name, image_path in replacement_tasks:
                    if data.m_Name == asset_name:
                        log(t('bamt.processing.png.matchFound', name=asset_name))
                        try:
                            img = Image.open(image_path).convert("RGBA")
                            data.image = img
                            data.save()
                            log(t('bamt.processing.png.replaceSuccess', name=data.m_Name))
                            replacement_count += 1
                            task_to_remove = (asset_name, image_path)
                            break 
                        except Exception as e:
                            log(t('bamt.processing.png.replaceFailed', name=asset_name, error=e))
                if task_to_remove:
                    replacement_tasks.remove(task_to_remove)

        if replacement_count == 0:
            log(t('bamt.processing.png.noReplacementWarning'))
            log(t('bamt.processing.png.noReplacementHint'))
            return False, t('bamt.processing.png.noReplacementError'), {
                "replaced": 0,
                "missing": [asset_name for asset_name, _ in replacement_tasks],
                "output": None,
            }
        
        log(t('bamt.processing.png.summary', count=replacement_count, total=original_tasks_count))

        if replacement_tasks:
            log(t('bamt.processing.png.unmatchedFilesWarning'))
            for asset_name, _ in replacement_tasks:
                log(f"  - {asset_name}")
        missing_assets = [asset_name for asset_name, _ in replacement_tasks]

        final_path = working_dir / target_bundle_path.name

        log(t('bamt.processing.png.savingFinal'))
        log(t('bamt.processing.png.savingDirect'))
        if not save_bundle(env, final_path, log):
            return False, t('bamt.processing.png.saveFailed'), {
                "replaced": replacement_count,
                "missing": missing_assets,
                "output": str(final_path) if final_path else None,
            }

        log(t('bamt.processing.png.finalPath', path=final_path))
        log(t('bamt.processing.png.processComplete'))
        return True, t('bamt.processing.png.processCompleteMessage', count=replacement_count), {
            "replaced": replacement_count,
            "missing": missing_assets,
            "output": str(final_path) if final_path else None,
        }

    except Exception as e:
        log(t('bamt.processing.fatalError', error=e))
        log(traceback.format_exc())
        return False, t('bamt.processing.fatalErrorMessage', error=e), {
            "replaced": 0,
            "missing": [],
            "output": None,
        }

def _b2b_replace(old_bundle_path: Path, new_bundle_path: Path, log, asset_types_to_replace: set):
    """
    执行 Bundle-to-Bundle 的核心替换逻辑。
    返回一个元组 (modified_env, replacement_count)，如果失败则 modified_env 为 None。
    """
    log(t('bamt.processing.b2b.extracting', types=', '.join(asset_types_to_replace)))
    old_env = load_bundle(old_bundle_path, log)
    if not old_env:
        return None, 0
    
    old_assets_map = {}
    for obj in old_env.objects:
        # 根据传入的类型集合进行筛选
        if obj.type.name in asset_types_to_replace:
            data = obj.read()
            # 使用 path_id 作为唯一主键，名称和类型仅用于显示
            asset_key = obj.path_id
            
            # 对于 Texture2D 类型，只提取其图像内容 (PIL.Image 对象)
            # 保留目标文件中的格式等元数据
            if obj.type.name == "Texture2D":
                old_assets_map[asset_key] = data.image
            # 对于其他类型的资源，仍然使用原始数据替换的旧方法
            else:
                old_assets_map[asset_key] = obj.get_raw_data()
    
    if not old_assets_map:
        log(t('bamt.processing.b2b.noAssetsWarning', types=', '.join(asset_types_to_replace)))
        return None, 0

    log(t('bamt.processing.b2b.extractSuccess', count=len(old_assets_map)))

    log(t('bamt.processing.b2b.scanningNew'))
    new_env = load_bundle(new_bundle_path, log)
    if not new_env:
        return None, 0

    replacement_count = 0
    replaced_assets = []
    for obj in new_env.objects:
        if obj.type.name in asset_types_to_replace:
            new_data = obj.read()
            # 使用 path_id 作为主键进行查找
            asset_key = obj.path_id
            if asset_key in old_assets_map:
                old_content = old_assets_map[asset_key]
                try:
                    # 对 Texture2D 进行特殊处理，保留目标文件中的格式等元数据
                    if obj.type.name == "Texture2D":
                        old_image = old_content
                        new_data.image = old_image
                        new_data.save()
                        log(t('bamt.processing.b2b.replaceImageSuccess', name=new_data.m_Name, format=new_data.m_TextureFormat.name))
                    # 对于其他资源类型，保持原有的原始数据替换逻辑
                    else:
                        # old_content 此处是原始字节数据
                        obj.set_raw_data(old_content)
                        log(t('bamt.processing.b2b.replaceAssetSuccess', name=new_data.m_Name, type=obj.type.name))

                    replacement_count += 1
                    replaced_assets.append(f"{new_data.m_Name} ({obj.type.name}, pathID: {obj.path_id})")
                except Exception as e:
                    log(t('bamt.processing.b2b.replaceAssetFailed', name=new_data.m_Name, type=obj.type.name, error=e))

    if replacement_count > 0:
        log(t('bamt.processing.b2b.totalReplaced', count=replacement_count))
        for name in replaced_assets:
            log(f"  - {name}")
    
    return new_env, replacement_count

def process_bundle_to_bundle_replacement(new_bundle_path: Path, old_bundle_path: Path, output_path: Path, log, create_backup_file: bool = True):
    """
    从旧版Bundle包替换指定资源类型到新版Bundle包。
    """
    try:
        if create_backup_file:
            if not create_backup(new_bundle_path, log, "b2b"):
                return False, t('bamt.processing.b2b.backupFailed')

        asset_types = {"Texture2D"}
        modified_env, replacement_count = _b2b_replace(old_bundle_path, new_bundle_path, log, asset_types)

        if not modified_env:
            return False, t('bamt.processing.b2b.replaceProcessFailed')
        
        if replacement_count == 0:
            log(t('bamt.processing.b2b.noMatchingTextureWarning'))
            log(t('bamt.processing.b2b.noMatchingTextureHint'))
            return False, t('bamt.processing.b2b.noMatchingTextureError')

        if save_bundle(modified_env, output_path, log):
            log(t('bamt.processing.b2b.processComplete'))
            return True, t('bamt.processing.b2b.processCompleteMessage', count=replacement_count, path=output_path)
        else:
            return False, t('bamt.processing.b2b.saveFailed')

    except Exception as e:
        log(t('bamt.processing.fatalError', error=e))
        log(traceback.format_exc())
        return False, t('bamt.processing.fatalErrorMessage', error=e)


def find_new_bundle_path(old_mod_path: Path, game_resource_dir: Path, log):
    """
    根据旧版Mod文件，在游戏资源目录中智能查找对应的新版文件。
    返回 (找到的路径对象, 状态消息) 的元组。
    """
    # TODO: 只用Texture2D比较好像不太对，但是it works

    log(t('bamt.processing.find.searching', name=old_mod_path.name))

    # 1. 通过日期模式确定文件名前缀，且扩展名相同
    date_match = re.search(r'\d{4}-\d{2}-\d{2}', old_mod_path.name)
    if not date_match:
        msg = t('bamt.processing.find.noDatePattern', name=old_mod_path.name)
        log(f"  > fail : {msg}")
        return None, msg

    prefix_end_index = date_match.start()
    search_prefix = old_mod_path.name[:prefix_end_index]
    extension = old_mod_path.suffix
    log(t('bamt.processing.find.prefixDetermined', prefix=search_prefix, ext=extension))

    # 2. 查找所有候选文件（前缀相同且扩展名一致）
    candidates = [f for f in game_resource_dir.iterdir() if f.is_file() and f.name.startswith(search_prefix) and f.suffix == extension]
    if not candidates:
        msg = t('bamt.processing.find.noCandidates', dir=game_resource_dir)
        log(f"  > fail : {msg}")
        return None, msg
    log(t('bamt.processing.find.candidatesFound', count=len(candidates)))

    # 3. 加载旧Mod获取贴图列表
    old_env = load_bundle(old_mod_path, log)
    if not old_env:
        msg = "loading old mod file failed."
        log(f"  > fail : {msg}")
        return None, msg
    
    old_textures_map = {obj.read().m_Name for obj in old_env.objects if obj.type.name == "Texture2D"}
    
    if not old_textures_map:
        msg = "old mod contains no texture2d resources."
        log(f"  > fail : {msg}")
        return None, msg
    log(f"  > old mod contains {len(old_textures_map)} texture resources.")

    # 4. 遍历候选文件，找到第一个包含匹配贴图的
    for candidate_path in candidates:
        log(f"    - checking: {candidate_path.name}")
        try:
            env = UnityPy.load(str(candidate_path))
            if not env: continue
            
            for obj in env.objects:
                if obj.type.name == "Texture2D" and obj.read().m_Name in old_textures_map:
                    msg = f"found matching texture: {candidate_path.name}"
                    log(f"  > ✅ {msg}")
                    return candidate_path, msg
        except Exception:
            log(f"    - warning: failed to load candidate file {candidate_path.name}, skipping.")
            continue
    
    msg = "No asset matching the old mod texture name was found in any candidate files. Unable to determine the correct new file."
    log(f"  > fail: {msg}")
    return None, msg


def process_mod_update(old_mod_path: Path, new_bundle_path: Path, working_dir: Path, log, asset_types_to_replace: set):
    """
    自动化Mod更新流程。
    此版本直接接收旧版Mod路径和新版资源路径，并且将文件保存在指定的working_dir下。
    """
    try:
        log(f"  > using old mod: {old_mod_path.name}")
        log(f"  > using new resources: {new_bundle_path.name}")
        log(f"  > using working directory: {working_dir}")

        # --- 1. 执行 B2B 替换 ---
        log("\n--- phase 1: Bundle-to-Bundle change ---")
        
        # 将资源类型集合传递给核心函数
        modified_env, replacement_count = _b2b_replace(old_mod_path, new_bundle_path, log, asset_types_to_replace)

        if not modified_env:
            return False, "Bundle-to-Bundle change process failed, please check the log for details.", {
                "replaced": 0,
                "skipped": 0,
                "output": None,
            }
        if replacement_count == 0:
            return False, "No matching resources found for replacement, unable to continue update.", {
                "replaced": 0,
                "skipped": 0,
                "output": None,
            }

        log(f"  > B2B change completed, processed {replacement_count} resources.")

        # --- 2. 保存最终文件 ---
        # 在工作目录下生成文件
        final_path = working_dir / new_bundle_path.name

        log(f"\n--- phase 2: Save final file ---")
        log(f"  > Preparing to save final file...")
        if not save_bundle(modified_env, final_path, log):
            return False, "Failed to save final file, operation aborted.", {
                "replaced": replacement_count,
                "skipped": 0,
                "output": str(final_path),
            }

        log(f"Final file saved to: {final_path}")
        log(f"\n🎉 All processing completed successfully!")
        return True, "Update completed successfully!", {
            "replaced": replacement_count,
            "skipped": 0,
            "output": str(final_path),
        }

    except Exception as e:
        log(f"\n❌ Critical error: An error occurred during the update process: {e}")
        log(traceback.format_exc())
        return False, f"Critical error occurred:\n{e}", {
            "replaced": 0,
            "skipped": 0,
            "output": None,
        }