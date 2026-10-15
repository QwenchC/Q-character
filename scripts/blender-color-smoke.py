import bpy
import json
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
output = root / 'docs' / 'color-validation'
model = output / 'export-80mm.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(model))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert meshes and all(o.data.uv_layers for o in meshes), 'Missing mesh or UVs'
points = [o.matrix_world @ Vector(p) for o in meshes for p in o.bound_box]
height = max(p.z for p in points) - min(p.z for p in points)
assert abs(height - 0.08) < 1e-5, height
textures = []
for obj in meshes:
    for slot in obj.material_slots:
        material = slot.material
        assert material and material.use_nodes
        principled = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        assert principled.inputs['Base Color'].is_linked, 'Texture is not linked to Base Color'
        images = [n.image for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
        assert images, 'No image texture nodes'
        for image in images:
            assert tuple(image.size) == (2048, 1024), tuple(image.size)
            assert image.packed_file, 'Texture requires an external file'
            colors = set(tuple(round(image.pixels[i + c] * 12) for c in range(3)) for i in range(0, len(image.pixels), 4 * 1000))
            assert len(colors) > 12, 'Texture appears monochrome'
            textures.append({'name': image.name, 'size': list(image.size), 'packed': True, 'sampledColors': len(colors)})

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 768
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('Soft background')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.72, 0.67, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
scene.view_settings.view_transform = 'Standard'
camera_data = bpy.data.cameras.new('Character Camera')
camera = bpy.data.objects.new('Character Camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 0.105
camera_data.clip_start = 0.001
camera_data.clip_end = 10
target = Vector((0, 0, 0.04))
for name, position, energy in [('Key', (0.1, -0.15, 0.18), 0.5), ('Fill', (-0.1, -0.08, 0.1), 0.2), ('Back', (0.1, 0.12, 0.16), 0.3)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.shape = 'DISK'
    data.size = 0.15
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (target - light.location).to_track_quat('-Z', 'Y').to_euler()
for name, position in [('front', (0, -0.24, 0.04)), ('back', (0, 0.24, 0.04))]:
    camera.location = position
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(output / f'blender-{name}.png')
    bpy.ops.render.render(write_still=True)
camera.location = (0, -0.24, 0.04)
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'MATERIAL'
blend = output / 'colored-character.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
report = {'blenderVersion': bpy.app.version_string, 'meshes': len(meshes), 'heightMeters': height, 'textures': textures, 'importedGLB': str(model), 'savedBlend': str(blend), 'rendered': ['blender-front.png', 'blender-back.png']}
(output / 'blender-validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('BLENDER_COLOR_VALIDATION', json.dumps(report))
