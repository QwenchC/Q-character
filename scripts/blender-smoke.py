import bpy
import json
import os
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
model = Path(os.environ.get("QCHARACTER_BLENDER_MODEL", str(root / "docs" / "smoke-assets" / "export-80mm.glb")))
output_dir = model.parent if os.environ.get("QCHARACTER_BLENDER_MODEL") else root / "docs"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(model))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
assert meshes, "No imported meshes"
points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
height = max(point.z for point in points) - min(point.z for point in points)
assert abs(height - 0.08) < 1e-5, f"Unexpected Blender height: {height}"
blend_path = model.parent / "example.blend"
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
report = {"blenderVersion": bpy.app.version_string, "meshes": len(meshes), "heightMeters": height, "importedGLB": str(model), "savedBlend": str(blend_path)}
(output_dir / "blender-validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print("BLENDER_VALIDATION", json.dumps(report))
