"""Builds the Apple Vision Pro copies of the 3D champion models: one model.usdz beside each
model.glb in web/public/assets/models/ (base models only, the same files the site's 3D showcase
and the Simulator replay use), and models-usdz.json listing them for the app.

visionOS (RealityKit) can't open the site's .glb files, which are meshopt-compressed with WebP
textures. Each model is decoded with the glTF tools, then Blender keeps the visible meshes and the
idle animation, gives each material its base-color texture, and writes Y-up USD; usd-core packs it
as a USDZ with PNG textures. One USD unit is one model unit (100 game units), times the champion's
scale from models.json, so the app can show champions at their real sizes against each other.

Setup (once):
  python3 -m venv /tmp/usdz-venv && /tmp/usdz-venv/bin/pip install bpy usd-core
  npm install --prefix /tmp/gltf @gltf-transform/cli@4

Run from the repo root:
  /tmp/usdz-venv/bin/python apps/visionos/tools/build_usdz.py [--only ahri,jinx] [--force]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODELS = os.path.join(REPO, "web", "public", "assets", "models")
GLTF = os.environ.get("GLTF_CLI", "/tmp/gltf/node_modules/.bin/gltf-transform")


def blender_convert(src, dst, idle, scale):
    """Runs inside this script under bpy (see --blender): glTF in, Y-up USD with the idle clip out."""
    import bpy  # noqa: I001 (bpy must load before bmesh)
    import bmesh

    texdir = os.path.join(os.path.dirname(dst), "tex")
    os.makedirs(texdir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        if not o.data.materials:  # helper shapes with no material are never drawn in game
            bpy.data.objects.remove(o)
            continue
        # Materials the game hides (extras.visible == false, as the site's viewers skip them).
        hidden = [i for i, m in enumerate(o.data.materials) if m and m.get("visible") is False]
        if hidden:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in hidden], context="FACES")
            bm.to_mesh(o.data)
            bm.free()
    # The models are unlit in the browser; on Vision Pro they're lit by the room, so each material
    # becomes a plain surface with its base-color texture, saved as PNG (USDZ can't hold WebP).
    for m in bpy.data.materials:
        img = next((n.image for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.8
        nt.links.new(bsdf.outputs[0], out.inputs[0])
        if img:
            if not img.get("png"):
                img.filepath_raw = os.path.join(texdir, img.name.split(".")[0] + ".png")
                img.file_format = "PNG"
                img.save()
                img["png"] = True
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    act = bpy.data.actions.get(idle) if idle else None
    for a in list(bpy.data.actions):
        if a is not act:
            bpy.data.actions.remove(a)
    scene = bpy.context.scene
    if arm and act:
        arm.animation_data_create()
        arm.animation_data.action = act
        if act.slots:
            arm.animation_data.action_slot = act.slots[0]
        scene.frame_start, scene.frame_end = int(act.frame_range[0]), int(act.frame_range[1])
    for o in bpy.data.objects:
        if o.parent is None:
            o.scale = [s * scale for s in o.scale]
    bpy.ops.wm.usd_export(
        filepath=dst, export_animation=bool(act), export_armatures=True, only_deform_bones=True,
        export_textures_mode="KEEP", generate_preview_surface=True, convert_world_material=False,
        convert_orientation=True, export_global_up_selection="Y", export_global_forward_selection="Z",
    )


def pack(usdc, usdz):
    """Points the textures at the PNGs and packs everything into one USDZ."""
    from pxr import Sdf, Usd, UsdUtils

    stage = Usd.Stage.Open(usdc)
    for prim in stage.Traverse():
        attr = prim.GetAttribute("inputs:file")
        if attr and attr.Get():
            name = os.path.splitext(os.path.basename(attr.Get().path))[0]
            attr.Set(Sdf.AssetPath(f"tex/{name}.png"))
    stage.GetRootLayer().Save()
    if not UsdUtils.CreateNewARKitUsdzPackage(usdc, usdz):
        raise RuntimeError(f"couldn't pack {usdz}")


def convert(name, entry, work):
    glb = os.path.join(MODELS, entry["file"])
    usdz = os.path.join(os.path.dirname(glb), "model.usdz")
    plain = os.path.join(work, "plain.glb")
    # Decode meshopt and quantized positions, so Blender's importer can read the model.
    subprocess.run([GLTF, "copy", glb, plain], check=True, capture_output=True)
    subprocess.run([GLTF, "dequantize", plain, plain], check=True, capture_output=True)
    usdc = os.path.join(work, "model.usdc")
    idle = (entry.get("clips") or {}).get("idle") or ""
    subprocess.run([sys.executable, __file__, "--blender", plain, usdc, idle, str(entry.get("scale") or 1)],
                   check=True, capture_output=True)
    pack(usdc, usdz)
    return os.path.relpath(usdz, MODELS)


def champion_names():
    """Display names by champion id ("MonkeyKing": "Wukong") from the mirrored Data Dragon files."""
    dd = os.path.join(REPO, "web", "public", "assets", "dd")
    for version in sorted(os.listdir(dd), reverse=True):
        path = os.path.join(dd, version, "data", "en_US", "champion.json")
        if os.path.exists(path):
            return {k: v["name"] for k, v in json.load(open(path))["data"].items()}
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated champion names")
    ap.add_argument("--force", action="store_true", help="rebuild models that already have a USDZ")
    ap.add_argument("--blender", nargs=4, help=argparse.SUPPRESS)
    args = ap.parse_args()
    if args.blender:
        src, dst, idle, scale = args.blender
        return blender_convert(src, dst, idle, float(scale))

    manifest = json.load(open(os.path.join(MODELS, "models.json")))
    names = champion_names()
    out_path = os.path.join(MODELS, "models-usdz.json")
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    only = {n.lower() for n in args.only.split(",")} if args.only else None
    failed = []
    for name, entry in sorted(manifest.items()):
        if only and name.lower() not in only:
            continue
        usdz = os.path.join(MODELS, os.path.dirname(entry["file"]), "model.usdz")
        if not args.force and name in out and os.path.exists(usdz):
            continue
        work = tempfile.mkdtemp(prefix="usdz-")
        try:
            out[name] = {"file": convert(name, entry, work), "name": names.get(name, name)}
            print(f"{name}: {os.path.getsize(usdz) / 1e6:.1f} MB")
        except Exception as e:  # keep going; the app shows the 2D page for champions without one
            failed.append(name)
            print(f"{name}: failed ({e})", file=sys.stderr)
        finally:
            shutil.rmtree(work, ignore_errors=True)
    for name in out:
        out[name]["name"] = names.get(name, name)
    with open(out_path, "w") as f:
        json.dump(dict(sorted(out.items())), f, indent=1)
        f.write("\n")
    print(f"{len(out)} USDZ models" + (f"; failed: {', '.join(failed)}" if failed else ""))


if __name__ == "__main__":
    main()
