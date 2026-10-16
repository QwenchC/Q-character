import bpy,json,sys,math
from pathlib import Path
from mathutils import Vector,Matrix
root=Path(__file__).resolve().parents[1]
out=root/'.runtime/triposplat-evaluation'
report=[]
for label,file in [('hunyuan',root/'docs/color-validation/colored-model.glb'),('triposplat',out/'triposplat-colored.glb'),('triposplat-smooth',out/'triposplat-smooth.glb')]:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(file))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
 low=Vector([min(p[i] for p in points) for i in range(3)]);high=Vector([max(p[i] for p in points) for i in range(3)])
 origin=Vector(((low.x+high.x)/2,(low.y+high.y)/2,low.z));scale=.08/(high.z-low.z)
 for o in meshes:
  matrix=o.matrix_world.copy()
  for v in o.data.vertices:v.co=(matrix@v.co-origin)*scale
  o.matrix_world=Matrix.Identity(4)
  if label.startswith('triposplat'):
   rotation=Matrix.Rotation(-math.pi/2,4,'Z')
   for v in o.data.vertices:v.co=rotation@v.co
  for p in o.data.polygons:p.use_smooth=True
 report.append({'model':label,'triangles':sum(len(o.data.polygons) for o in meshes),'vertices':sum(len(o.data.vertices) for o in meshes),'colorAttributes':[list(o.data.color_attributes.keys()) for o in meshes],'uvLayers':[list(o.data.uv_layers.keys()) for o in meshes]})
 scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=480;scene.render.resolution_y=600;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.world=bpy.data.worlds.new('Background');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.72,.74,.70,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.3;scene.view_settings.view_transform='Standard'
 target=Vector((0,0,.04));data=bpy.data.cameras.new('Camera');camera=bpy.data.objects.new('Camera',data);scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO';data.ortho_scale=.102;data.clip_start=.001;data.clip_end=10
 for name,position,energy in [('Key',(.1,-.15,.18),.5),('Fill',(-.1,-.08,.1),.2),('Back',(.1,.12,.16),.3)]:
  data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=.15;light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=position;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
 for view,position in [('front',(0,-.24,.04)),('back',(0,.24,.04)),('clay',(.09,-.23,.05))]:
  if view=='clay':
   mat=bpy.data.materials.new('Clay');mat.diffuse_color=(.6,.65,.56,1);mat.use_nodes=True;bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.6,.65,.56,1);bsdf.inputs['Roughness'].default_value=.85
   for o in meshes:o.data.materials.clear();o.data.materials.append(mat)
  camera.location=position;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/f'{label}-{view}.png');bpy.ops.render.render(write_still=True)
(out/'comparison.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print('COMPARISON',json.dumps(report))
