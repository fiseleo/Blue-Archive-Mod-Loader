#!/usr/bin/env python3
"""Command-line toolkit backing the BAMT Electron UI.

This script intentionally mirrors a subset of the legacy Tkinter application
but removes CRC correction logic. It exposes two subcommands:

- mod-update: Perform bundle-to-bundle replacement between an older mod bundle
  and a newer game bundle.
- png-replace: Replace Texture2D assets inside a bundle using PNG files.

Output uses simple line-based logging followed by a single JSON result line so
that the Electron renderer can parse structured data reliably.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

import UnityPy
from PIL import Image

LOG_PREFIX = "LOG:"
RESULT_PREFIX = "RESULT:"


def log(message: str, level: str = "info") -> None:
    """Emit a line-oriented log entry."""
    print(f"{LOG_PREFIX}{level}:{message}", flush=True)


def emit_result(data: Dict[str, object]) -> None:
    print(f"{RESULT_PREFIX}{json.dumps(data, ensure_ascii=False)}", flush=True)


def ensure_exists(path: Path, kind: str) -> Path:
    if not path.exists():
        raise FileNotFoundError(f"{kind} does not exist: {path}")
    return path


def save_environment(env: UnityPy.Environment, output_path: Path, enable_padding: bool) -> None:
    padding = 16 if enable_padding else 0
    with output_path.open("wb") as f:
        f.write(env.file.save(padding=padding))


def create_backup_if_needed(target_path: Path, enable_backup: bool) -> Optional[Path]:
    if not enable_backup or not target_path.exists():
        return None
    backup_path = target_path.with_suffix(target_path.suffix + ".bak")
    shutil.copy2(target_path, backup_path)
    return backup_path


def gather_texture_sources(env: UnityPy.Environment, allowed_types: Iterable[str]) -> Dict[Tuple[str, str], object]:
    sources: Dict[Tuple[str, str], object] = {}
    for obj in env.objects:
        if obj.type.name not in allowed_types:
            continue
        data = obj.read()
        key = (obj.type.name, getattr(data, "name", getattr(data, "m_Name", "")))
        if not key[1]:
            continue
        sources[key] = data
    return sources


def apply_texture2d_replacement(target, source) -> None:
    # Texture2D supports replacing via PIL image.
    try:
        target.set_image(source.image)
    except Exception:
        # Fallback: copy raw image data attributes.
        target.image_data = source.image_data
        target.mip_count = getattr(source, "mip_count", target.mip_count)
        target.m_Width = getattr(source, "m_Width", target.m_Width)
        target.m_Height = getattr(source, "m_Height", target.m_Height)


def apply_textasset_replacement(target, source) -> None:
    target.script = source.script


def apply_mesh_replacement(target, source) -> None:
    # Mesh replacement is straightforward because UnityPy copies the data tree.
    target.m_VertexData = source.m_VertexData
    target.m_IndexBuffer = source.m_IndexBuffer
    target.m_SubMeshes = source.m_SubMeshes
    target.m_BindPose = source.m_BindPose


def perform_mod_update(
    old_mod: Path,
    new_bundle: Path,
    output_dir: Path,
    output_name: Optional[str],
    enable_padding: bool,
    enable_backup: bool,
    replace_texture: bool,
    replace_textasset: bool,
    replace_mesh: bool,
) -> Dict[str, object]:
    ensure_exists(old_mod, "Old mod bundle")
    ensure_exists(new_bundle, "Target bundle")
    output_dir.mkdir(parents=True, exist_ok=True)

    asset_types = set()
    if replace_texture:
        asset_types.add("Texture2D")
    if replace_textasset:
        asset_types.add("TextAsset")
    if replace_mesh:
        asset_types.add("Mesh")

    if not asset_types:
        raise ValueError("No asset replacement types were enabled.")

    log("Loading legacy mod bundle...", "info")
    old_env = UnityPy.load(str(old_mod))
    sources = gather_texture_sources(old_env, asset_types)
    if not sources:
        raise RuntimeError("No matching assets were found inside the legacy mod bundle.")
    log(f"Collected {len(sources)} candidate assets for replacement.")

    log("Loading target bundle...", "info")
    new_env = UnityPy.load(str(new_bundle))

    replaced = 0
    skipped = 0

    for obj in new_env.objects:
        if obj.type.name not in asset_types:
            continue
        data = obj.read()
        key = (obj.type.name, getattr(data, "name", getattr(data, "m_Name", "")))
        if key not in sources:
            skipped += 1
            continue
        source_data = sources[key]
        if obj.type.name == "Texture2D":
            apply_texture2d_replacement(data, source_data)
        elif obj.type.name == "TextAsset":
            apply_textasset_replacement(data, source_data)
        elif obj.type.name == "Mesh":
            apply_mesh_replacement(data, source_data)
        replaced += 1

    log(f"Replaced {replaced} assets; skipped {skipped}.")

    if replaced == 0:
        raise RuntimeError("No assets were replaced. Ensure the selected bundles share asset names.")

    output_name = output_name or new_bundle.name
    output_path = output_dir / output_name

    backup_path = create_backup_if_needed(output_path, enable_backup)
    if backup_path:
        log(f"Backup saved to {backup_path}")

    log(f"Saving updated bundle to {output_path} (padding={'on' if enable_padding else 'off'})")
    save_environment(new_env, output_path, enable_padding)

    return {
        "status": "success",
        "replaced": replaced,
        "skipped": skipped,
        "output": str(output_path),
    }


def perform_png_replace(
    bundle_path: Path,
    image_folder: Path,
    output_dir: Path,
    enable_padding: bool,
) -> Dict[str, object]:
    ensure_exists(bundle_path, "Target bundle")
    ensure_exists(image_folder, "PNG folder")
    output_dir.mkdir(parents=True, exist_ok=True)

    image_map: Dict[str, Path] = {}
    for png in image_folder.glob("*.png"):
        image_map[png.stem] = png

    if not image_map:
        raise RuntimeError("The PNG folder does not contain any .png files.")

    log(f"Preparing to replace up to {len(image_map)} textures from {bundle_path.name}")

    env = UnityPy.load(str(bundle_path))
    replaced = 0
    seen_names = set()

    for obj in env.objects:
        if obj.type.name != "Texture2D":
            continue
        data = obj.read()
        key = getattr(data, "name", getattr(data, "m_Name", ""))
        if key:
            seen_names.add(key)
        image_path = image_map.get(key)
        if not image_path:
            continue
        with Image.open(image_path) as img:
            data.set_image(img.convert("RGBA"))
        replaced += 1

    missing = sorted(set(image_map.keys()) - seen_names)

    if replaced == 0:
        raise RuntimeError("No textures were replaced. Check filename casing and bundle contents.")

    log(f"Successfully replaced {replaced} textures.")
    if missing:
        log("Textures not found in bundle: " + ", ".join(missing), "warning")

    output_path = output_dir / bundle_path.name
    log(f"Saving updated bundle to {output_path} (padding={'on' if enable_padding else 'off'})")
    save_environment(env, output_path, enable_padding)

    return {
        "status": "success",
        "replaced": replaced,
        "missing": missing,
        "output": str(output_path),
    }


def parse_arguments(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="BA-Modding-Toolkit CLI (no CRC)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    mod_update = subparsers.add_parser("mod-update", help="Run bundle-to-bundle replacement")
    mod_update.add_argument("--old-mod", required=True, type=Path)
    mod_update.add_argument("--new-bundle", required=True, type=Path)
    mod_update.add_argument("--output-dir", required=True, type=Path)
    mod_update.add_argument("--output-name", type=str, default=None)
    mod_update.add_argument("--enable-padding", action="store_true")
    mod_update.add_argument("--create-backup", action="store_true")
    mod_update.add_argument("--replace-texture", action="store_true", default=False)
    mod_update.add_argument("--replace-textasset", action="store_true", default=False)
    mod_update.add_argument("--replace-mesh", action="store_true", default=False)

    png_replace = subparsers.add_parser("png-replace", help="Replace textures using PNG files")
    png_replace.add_argument("--bundle", required=True, type=Path)
    png_replace.add_argument("--png-folder", required=True, type=Path)
    png_replace.add_argument("--output-dir", required=True, type=Path)
    png_replace.add_argument("--enable-padding", action="store_true")

    return parser.parse_args(argv)


def main(argv: Optional[Iterable[str]] = None) -> int:
    try:
        args = parse_arguments(argv)
        if args.command == "mod-update":
            result = perform_mod_update(
                old_mod=args.old_mod,
                new_bundle=args.new_bundle,
                output_dir=args.output_dir,
                output_name=args.output_name,
                enable_padding=args.enable_padding,
                enable_backup=args.create_backup,
                replace_texture=args.replace_texture,
                replace_textasset=args.replace_textasset,
                replace_mesh=args.replace_mesh,
            )
        elif args.command == "png-replace":
            result = perform_png_replace(
                bundle_path=args.bundle,
                image_folder=args.png_folder,
                output_dir=args.output_dir,
                enable_padding=args.enable_padding,
            )
        else:
            raise ValueError(f"Unknown command: {args.command}")
        emit_result(result)
        return 0
    except Exception as exc:  # pylint: disable=broad-except
        log(f"Error: {exc}", "error")
        emit_result({"status": "error", "message": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
