"""Video-derived visual reconstruction. Arbitrary units, not manufacturing CAD.
Run with Blender --background --python scripts/build_ring.py
"""
import bpy, math, os
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metal, rough):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) or m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    out = next((n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL'), None) or m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    m.node_tree.links.new(bsdf.outputs[0], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Coat Weight'].default_value = 0.18
    bsdf.inputs['Coat Roughness'].default_value = 0.08
    return m

gold = material('Pale champagne gold', (0.88, 0.81, 0.56), 1, 0.09)
silver = material('Polished silver beads', (0.66, 0.68, 0.71), 0.84, 0.24)
RADIUS, COUNT, BEAD_RADIUS = 1.30, 20, 0.195

def convert(p): return (p[0], -p[2], p[1])

def solid_flowing_channel():
    """The reference is a turning ribbon channel, NOT a fixed circular inner liner.
    A solid gold back and its two lips turn together by one full revolution.
    The open side and the closed side exchange inside/outside around the ring.
    """
    verts,faces=[],[]
    n,arc_steps=640,72
    inner_radius,outer_radius=0.205,0.250
    half_opening=1.18
    first=math.pi/2+half_opening
    last=math.pi/2-half_opening+2*math.pi
    angles=[first+(last-first)*j/(arc_steps-1) for j in range(arc_steps)]
    # A softly flattened channel back: broader than a circular tube, with
    # continuous curvature through the entire inside-out transition.
    def section(radius,a):
        c,s=math.cos(a),math.sin(a)
        return Vector((radius*math.copysign(abs(c)**0.77,c),
                       radius*math.copysign(abs(s)**0.77,s)))
    contour=[section(inner_radius,a) for a in angles]
    contour += [section(outer_radius,a) for a in reversed(angles)]
    profile=[]
    corners={0,arc_steps-1,arc_steps,len(contour)-1}
    for j,cur in enumerate(contour):
        if j not in corners:profile.append(cur);continue
        prev,nxt=contour[j-1],contour[(j+1)%len(contour)]
        radius=min(0.010,(prev-cur).length*0.38,(nxt-cur).length*0.38)
        start=cur+(prev-cur).normalized()*radius
        end=cur+(nxt-cur).normalized()*radius
        for k in range(6):
            q=k/5
            profile.append((1-q)**2*start+2*q*(1-q)*cur+q*q*end)
    m=len(profile)
    for i in range(n):
        t=2*math.pi*i/n
        alpha=t-math.pi/2+0.25
        radial=Vector((math.cos(t),math.sin(t),0))
        depth=Vector((0,0,1))
        v=radial*math.cos(alpha)+depth*math.sin(alpha)
        u=depth*math.cos(alpha)-radial*math.sin(alpha)
        center=radial*RADIUS
        for a,b in profile:verts.append(convert(center+u*a+v*b))
    for i in range(n):
        for j in range(m):
            a=i*m+j;b=((i+1)%n)*m+j;c=((i+1)%n)*m+(j+1)%m;d=i*m+(j+1)%m
            faces.append((a,d,c,b))
    mesh=bpy.data.meshes.new('Continuous turning gold channel - closed back, open face')
    mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new('Gold shank - turning ribbon with solid backing',mesh)
    bpy.context.collection.objects.link(obj);obj.data.materials.append(gold)
    for p in mesh.polygons:p.use_smooth=True
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');obj.select_set(False)
    obj['construction']='Closed backing turns with channel; not a separate static bore'
    obj['reference_basis']='Full video rotation and supplied stills; visual reconstruction'
    return obj

solid_flowing_channel()
for i in range(COUNT):
    t=2*math.pi*i/COUNT
    pos=convert((RADIUS*math.cos(t),RADIUS*math.sin(t),0))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=BEAD_RADIUS, location=pos)
    obj=bpy.context.object; obj.name=f'Silver bead {i+1:02d}'
    obj.data.materials.append(silver)
    for poly in obj.data.polygons: poly.use_smooth=True
# Export reusable, fully materialed asset. Camera framing is owned by the viewer.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public/models/ring.glb'),export_format='GLB',export_apply=True,export_materials='EXPORT',use_selection=True)
# Editable source includes studio lights and a camera for future refinement.
world=bpy.data.worlds.new('Black studio'); bpy.context.scene.world=world
world.use_nodes=True
bg=next((n for n in world.node_tree.nodes if n.type=='BACKGROUND'),None) or world.node_tree.nodes.new('ShaderNodeBackground')
wo=next((n for n in world.node_tree.nodes if n.type=='OUTPUT_WORLD'),None) or world.node_tree.nodes.new('ShaderNodeOutputWorld')
world.node_tree.links.new(bg.outputs[0],wo.inputs[0]);bg.inputs[0].default_value=(0,0,0,1)

def area(name,pos,power,size,size_y):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='RECTANGLE';data.size=size;data.size_y=size_y
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=convert(pos)
    o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
area('Key softbox',(-3,4,5),500,4,2.5)
area('Right strip',(4,0,3),350,1,5)
area('Upper rim',(-1,5,-2),450,3,1)
area('Lower fill',(1,-3,3),120,4,1)
bpy.ops.object.camera_add(location=convert((3.1,1.6,6.2)))
cam=bpy.context.object;cam.name='Reference camera';cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=4.0
scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.samples=96
scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'models/ring.blend'))
print('Exported ring: 1 turning channel with solid backing, 20 larger silver beads. Visual approximation only.')
