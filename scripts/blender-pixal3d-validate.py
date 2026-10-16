import argparse, bpy, json, sys
from pathlib import Path
from mathutils import Vector, Matrix

parser = argparse.ArgumentParser()
parser.add_argument('--model', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--require-80mm', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(args.model.resolve()))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert meshes and all(o.data.uv_layers for o in meshes), 'Missing mesh or UV'
points = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
height = high.z - low.z
if args.require_80mm:
    assert abs(height - .08) < 1e-5, height
materials = []
for o in meshes:
    for slot in o.material_slots:
        material = slot.material
        assert material and material.use_nodes
        bsdf = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        assert all(bsdf.inputs[key].is_linked for key in ['Base Color', 'Metallic', 'Roughness', 'Normal']), 'Missing PBR connection'
        images = {n.image.name: n.image for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
        assert len(images) >= 3 and all(image.packed_file for image in images.values()), 'Missing embedded PBR textures'
        materials.append({'name': material.name, 'channels': ['baseColor', 'metallic', 'roughness', 'normal'], 'images': [{'name': i.name, 'size': list(i.size), 'packed': True} for i in images.values()]})

report = {'model': str(args.model), 'blender': bpy.app.version_string, 'heightMeters': height, 'triangles': sum(len(o.data.polygons) for o in meshes), 'materials': materials}
# Keep imported dimensions above as evidence; normalize only for comparable renders.
origin = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
for o in meshes:
    transform = o.matrix_world.copy()
    for v in o.data.vertices:
        v.co = (transform @ v.co - origin) * (.08 / height)
    o.matrix_world = Matrix.Identity(4)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 480, 600
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('Soft background')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.72, .74, .70, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .3
scene.view_settings.view_transform = 'Standard'
target = Vector((0, 0, .04))
camera_data = bpy.data.cameras.new('Camera')
camera = bpy.data.objects.new('Camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type, camera_data.ortho_scale = 'ORTHO', .102
camera_data.clip_start, camera_data.clip_end = .001, 10
for name, position, energy in [('Key', (.1, -.15, .18), .5), ('Fill', (-.1, -.08, .1), .2), ('Back', (.1, .12, .16), .3)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = energy, 'DISK', .15
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (target - light.location).to_track_quat('-Z', 'Y').to_euler()
for view, position in [('front', (0, -.24, .04)), ('left', (.24, 0, .04)), ('back', (0, .24, .04)), ('right', (-.24, 0, .04)), ('clay', (.09, -.23, .05))]:
    if view == 'clay':
        clay = bpy.data.materials.new('Clay')
        clay.use_nodes = True
        clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.6, .65, .56, 1)
        clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .85
        for o in meshes:
            o.data.materials.clear()
            o.data.materials.append(clay)
    camera.location = position
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str((args.output / f'pixal3d-{view}.png').resolve())
    bpy.ops.render.render(write_still=True)
(args.output / 'blender-validation.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print('PIXAL3D_BLENDER', json.dumps(report))
