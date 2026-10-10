"""Independent small oval step-cut sapphire. Display geometry, arbitrary units.
Blender --background --python scripts/build_sapphire.py
"""
import bpy, bmesh, math, os, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
SHORT, LONG, COUNT, OFFSET = 0.125, 0.180, 20, 0.10
verts, faces = [], []

def oval(radius, height):
    indices = []
    for i in range(16):
        angle = math.tau * i / 16
        indices.append(len(verts))
        # Three +Z is the optical axis; the oval's long axis is tangent to the ring.
        verts.append((SHORT * radius * math.cos(angle), -height, LONG * radius * math.sin(angle)))
    return indices

table = oval(0.52, 0.058)
girdle_top = oval(1, 0.003)
girdle_bottom = oval(1, -0.003)
pavilion_upper = oval(0.62, -0.055)
pavilion_lower = oval(0.22, -0.087)
tip = len(verts)
verts.append((0, 0.102, 0))
faces.append(tuple(table))
for upper, lower in [(table, girdle_top), (girdle_top, girdle_bottom),
                     (girdle_bottom, pavilion_upper), (pavilion_upper, pavilion_lower)]:
    for i in range(16):
        j = (i + 1) % 16
        faces.append((upper[i], upper[j], lower[j], lower[i]))
for i in range(16):
    faces.append((pavilion_lower[i], pavilion_lower[(i + 1) % 16], tip))

mesh = bpy.data.meshes.new('Oval table, 16 crown facets, stepped pavilion')
mesh.from_pydata(verts, [], faces)
bm = bmesh.new(); bm.from_mesh(mesh)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
mesh.update()
obj = bpy.data.objects.new('Small oval sapphire', mesh)
bpy.context.collection.objects.link(obj)
material = bpy.data.materials.new('Blue sapphire - IOR 1.766')
material.use_nodes = True
bsdf = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Base Color'].default_value = (0.024, 0.07, 0.28, 1)
bsdf.inputs['Roughness'].default_value = 0.015
bsdf.inputs['IOR'].default_value = 1.766
bsdf.inputs['Transmission Weight'].default_value = 1
mesh.materials.append(material)
for poly in mesh.polygons: poly.use_smooth = False
obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, 'public/models/sapphire.glb'),
    export_format='GLB', use_selection=True, export_materials='EXPORT')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'models/sapphire.blend'))

bm = bmesh.new(); bm.from_mesh(mesh)
non_manifold = sum(not e.is_manifold for e in bm.edges)
volume = bm.calc_volume(signed=True); bm.free()
planarity = max(abs(p.normal.dot(mesh.vertices[v].co - p.center)) for p in mesh.polygons for v in p.vertices)
convex_error = max(p.normal.dot(v.co - p.center) for p in mesh.polygons for v in mesh.vertices)
with bpy.data.libraries.load(os.path.join(ROOT, 'models/ring.blend'), link=False) as (src, dst):
    dst.objects = [name for name in src.objects if name.startswith('Gold shank')]
gold = dst.objects[0]
gold_bvh = BVHTree.FromPolygons([v.co for v in gold.data.vertices], [p.vertices for p in gold.data.polygons])
centers, collisions = [], []
convert = lambda p: Vector((p.x, -p.z, p.y))
for i in range(COUNT):
    t = math.tau * i / COUNT; alpha = t - math.pi / 2 + 0.25
    radial = Vector((math.cos(t), math.sin(t), 0)); depth = Vector((0, 0, 1))
    v = radial * math.cos(alpha) + depth * math.sin(alpha)
    u = depth * math.cos(alpha) - radial * math.sin(alpha)
    y = v.cross(u)
    center = radial * 1.30 + v * OFFSET
    centers.append(center)
    world = []
    for p in mesh.vertices:
        local = Vector((p.co.x, p.co.z, -p.co.y))
        world.append(convert(center + u * local.x + y * local.y + v * local.z))
    gem_bvh = BVHTree.FromPolygons(world, [p.vertices for p in mesh.polygons])
    collisions.append(len(gold_bvh.overlap(gem_bvh)))
gap = min((centers[i] - centers[j]).length - 2 * LONG for i in range(COUNT) for j in range(i + 1, COUNT))
mesh.calc_loop_triangles()
report = dict(count=COUNT, dimensions=[2 * SHORT, 2 * LONG, 0.160], mounting_offset=OFFSET,
    cut='independent oval step cut', optical_facets=len(faces) - 16, girdle_faces=16,
    triangles=len(mesh.loop_triangles), closed_edges=non_manifold == 0, positive_volume=volume > 0,
    max_planarity_error=planarity, convex_error=convex_error,
    gold_intersections_by_gem=collisions, min_neighbor_bounding_sphere_gap=gap)
assert non_manifold == 0 and volume > 0 and planarity < 1e-6 and convex_error < 1e-6, report
assert max(collisions) == 0 and gap > 0, report
with open(os.path.join(ROOT, 'docs/sapphire-validation.json'), 'w') as f: json.dump(report, f, indent=2)
print(json.dumps(report))
