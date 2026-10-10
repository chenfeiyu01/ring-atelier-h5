"""Closed 57-facet round brilliant, plus 16 girdle faces. Visual model, not a cut certificate.
Blender --background --python scripts/build_diamond.py
"""
import bpy, bmesh, math, os, json
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
R = 0.29
COUNT = 10
OFFSET = 0.22
verts, faces = [], []

def ring(count, radius, height, offset=0):
    indices = []
    for i in range(count):
        a = 2 * math.pi * i / count + offset
        indices.append(len(verts))
        # Three.js +Z is the optical axis; convert to Blender coordinates.
        verts.append((R * radius * math.cos(a), -R * height, R * radius * math.sin(a)))
    return indices

table = ring(8, 0.56, 0.315)
star_z = 0.012 + (0.315 - 0.012) * (1 - 0.8 * math.cos(math.pi / 8)) / (1 - 0.56)
star = ring(8, 0.8, star_z, math.pi / 8)
top = ring(16, 1, 0.012)
bottom = ring(16, 1, -0.012)
lower_z = -0.85 + (0.85 - 0.012) * 0.24 * math.cos(math.pi / 8)
lower = ring(8, 0.24, lower_z, math.pi / 8)
tip = len(verts)
verts.append((0, R * 0.85, 0))
faces.append(tuple(table))
for i in range(8):
    n = (i + 1) % 8
    g, mid, gn = 2 * i, 2 * i + 1, (2 * i + 2) % 16
    faces.extend([
        (table[i], table[n], star[i]),
        (table[i], star[i], top[g], star[i - 1]),
        (star[i], top[g], top[mid]), (star[i], top[mid], top[gn]),
        (tip, lower[i - 1], bottom[g], lower[i]),
        (lower[i], bottom[g], bottom[mid]), (lower[i], bottom[mid], bottom[gn]),
    ])
for i in range(16):
    n = (i + 1) % 16
    faces.append((top[i], top[n], bottom[n], bottom[i]))
mesh = bpy.data.meshes.new('57 optical facets and 16 girdle faces')
mesh.from_pydata(verts, [], faces)
bm = bmesh.new(); bm.from_mesh(mesh)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
mesh.update()
obj = bpy.data.objects.new('Round brilliant diamond', mesh)
bpy.context.collection.objects.link(obj)
material = bpy.data.materials.new('Diamond - IOR 2.417')
material.use_nodes = True
bsdf = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
bsdf.inputs['Roughness'].default_value = 0.012
bsdf.inputs['IOR'].default_value = 2.417
bsdf.inputs['Transmission Weight'].default_value = 1
mesh.materials.append(material)
for poly in mesh.polygons: poly.use_smooth = False
obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, 'public/models/diamond.glb'),
    export_format='GLB', use_selection=True, export_materials='EXPORT')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'models/diamond.blend'))

bm = bmesh.new(); bm.from_mesh(mesh)
non_manifold = sum(not e.is_manifold for e in bm.edges)
volume = bm.calc_volume(signed=True); bm.free()
planarity = max(abs(p.normal.dot(mesh.vertices[v].co - p.center)) for p in mesh.polygons for v in p.vertices)
convex_error = max(p.normal.dot(v.co - p.center) for p in mesh.polygons for v in mesh.vertices)

# Check the actual transformed gems against the existing gold channel.
with bpy.data.libraries.load(os.path.join(ROOT, 'models/ring.blend'), link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n.startswith('Gold shank')]
gold = dst.objects[0]
gold_bvh = BVHTree.FromPolygons([v.co for v in gold.data.vertices], [p.vertices for p in gold.data.polygons])
centers, collisions = [], []
convert = lambda p: Vector((p.x, -p.z, p.y))
for i in range(COUNT):
    t = 2 * math.pi * i / COUNT; alpha = t - math.pi / 2 + 0.25
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
gap = min((centers[i] - centers[j]).length - 2 * R for i in range(COUNT) for j in range(i + 1, COUNT))
report = dict(count=COUNT, radius=R, mounting_offset=OFFSET, optical_facets=57, girdle_faces=16, closed_edges=non_manifold == 0,
    positive_volume=volume > 0, max_planarity_error=planarity, convex_error=convex_error,
    gold_intersections_by_gem=collisions, min_neighbor_bounding_sphere_gap=gap)
assert non_manifold == 0 and volume > 0 and planarity < 1e-6 and convex_error < 1e-6
assert max(collisions) == 0 and gap > 0, report
with open(os.path.join(ROOT, 'docs/diamond-validation.json'), 'w') as f: json.dump(report, f, indent=2)
print(json.dumps(report))
