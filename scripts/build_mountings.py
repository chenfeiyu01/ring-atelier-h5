"""Two settings: tapered four-prong solitaire and a triangular three-bead cage.
Visual models in arbitrary units, derived from public design references and a supplied image.
Blender --background --python scripts/build_mountings.py
"""
import bpy, bmesh, math, os, json
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAU = math.tau
reports = {}
objects, cuts = [], []

def xyz(p): return Vector((p[0], -p[2], p[1]))

def begin():
    global objects, cuts, platinum
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    objects, cuts = [], []
    platinum = bpy.data.materials.new('Polished platinum')
    platinum.diffuse_color = (0.673, 0.637, 0.585, 1)
    platinum.use_nodes = True
    bsdf = next(n for n in platinum.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = platinum.diffuse_color
    bsdf.inputs['Metallic'].default_value = 1
    bsdf.inputs['Roughness'].default_value = 0.11

def mesh_object(name, verts, faces, mat=None, smooth=True):
    mesh = bpy.data.meshes.new(name); mesh.from_pydata([xyz(v) for v in verts], [], faces)
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free(); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat or platinum)
    for f in mesh.polygons: f.use_smooth = smooth
    objects.append(obj)
    return obj

def sweep(name, points, normals, widths, depths, closed=False, flat=False):
    points = [Vector(p) for p in points]
    normals = [Vector(p) for p in normals]
    verts, faces, section = [], [], 16
    n = len(points)
    for i, (center, normal) in enumerate(zip(points, normals)):
        before, after = points[(i - 1) % n], points[(i + 1) % n]
        if not closed and i == 0: before = points[0]
        if not closed and i == n - 1: after = points[-1]
        tangent = (after - before).normalized()
        normal = (normal - tangent * normal.dot(tangent)).normalized()
        across = tangent.cross(normal).normalized()
        for j in range(section):
            if flat:
                # Four small corner arcs joined by broad planar top/bottom faces.
                corner, step = divmod(j, 4)
                a = (corner * math.pi / 2) + step * math.pi / 6
                sx = 1 if corner in (0, 3) else -1
                sy = 1 if corner in (0, 1) else -1
                radius = min(0.004, widths[i] / 3, depths[i] / 3)
                w = sx * (widths[i] - radius) + radius * math.cos(a)
                d = sy * (depths[i] - radius) + radius * math.sin(a)
            else:
                a = TAU * j / section
                c, s = math.cos(a), math.sin(a)
                w = widths[i] * math.copysign(abs(c) ** 0.82, c)
                d = depths[i] * math.copysign(abs(s) ** 0.82, s)
            verts.append(center + across * w + normal * d)
    for i in range(n if closed else n - 1):
        k = (i + 1) % n
        for j in range(section):
            q = (j + 1) % section
            faces.append((i * section + j, i * section + q, k * section + q, k * section + j))
    if not closed:
        faces.append(tuple(range(section - 1, -1, -1)))
        faces.append(tuple((n - 1) * section + j for j in range(section)))
    obj = mesh_object(name, verts, faces)
    if flat:
        # Keep the broad faces planar; interpolate only across the rounded edges.
        for polygon in obj.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4 and polygon.index % section % 4 != 3
    return obj

def tube(name, points, radius=0.018, normal=(0, 0, 1), closed=False):
    return sweep(name, points, [normal] * len(points), [radius] * len(points), [radius] * len(points), closed)

def bezier(a, b, c, d, n=32):
    a, b, c, d = map(Vector, (a, b, c, d))
    return [(1 - q) ** 3 * a + 3 * (1 - q) ** 2 * q * b + 3 * (1 - q) * q * q * c + q ** 3 * d
            for q in (i / (n - 1) for i in range(n))]

def sphere(name, center, radius, mat=None, cutter=False):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20 if cutter else 24, ring_count=12 if cutter else 16,
        radius=radius, location=xyz(center))
    obj = bpy.context.object; obj.name = name
    if not cutter:
        obj.data.materials.append(mat or platinum)
        for f in obj.data.polygons: f.use_smooth = True
        objects.append(obj)
    return obj

def stone_slot(name, center, normal, across, diamond_scale, sapphire_scale, silver_radius, role='main'):
    normal, across = Vector(normal).normalized(), Vector(across).normalized()
    across = (across - normal * normal.dot(across)).normalized()
    along = normal.cross(across).normalized()
    obj = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(obj)
    obj.location = xyz(center)
    # Conjugate the basis by Blender/glTF's axis conversion. The loaded gem's
    # local +Z must face the seat normal, with its long axis along local +Y.
    obj.rotation_euler = Matrix((xyz(across), -xyz(normal), xyz(along))).transposed().to_euler()
    obj['inlay_slot'] = role
    obj['diamond_scale'] = diamond_scale
    obj['sapphire_scale'] = sapphire_scale
    obj['silver_radius'] = silver_radius
    objects.append(obj)
    return obj

def carve_seats(obj, cutters):
    if not cutters: return
    bpy.ops.object.select_all(action='DESELECT')
    for cutter in cutters: cutter.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]
    bpy.ops.object.join(); tool = bpy.context.object
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Open gemstone seats', 'BOOLEAN'); mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'; mod.object = tool
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(tool, do_unlink=True)

def export(name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, f'public/models/{name}.glb'), export_format='GLB',
        use_selection=True, export_materials='EXPORT', export_extras=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, f'models/{name}.blend'))
    meshes = [o for o in objects if o.type == 'MESH']
    non_manifold, triangles = 0, 0
    for obj in meshes:
        bm = bmesh.new(); bm.from_mesh(obj.data)
        non_manifold += sum(not e.is_manifold for e in bm.edges); bm.free()
        obj.data.calc_loop_triangles(); triangles += len(obj.data.loop_triangles)
    assert non_manifold == 0, (name, non_manifold)
    reports[name] = dict(meshes=len(meshes), triangles=triangles, non_manifold_edges=non_manifold,
        main_slots=sum(o.get('inlay_slot') == 'main' for o in objects),
        accent_slots=sum(o.get('inlay_slot') == 'accent' for o in objects),
        fixed_pearls=sum(bool(o.get('fixed_pearl')) for o in objects),
        note='Seat openings are intentional. These are display models, not manufacturing CAD.')

# Slender tapered shoulders, four curved prongs and an open flower-like gallery.
# Public proportion reference: Tiffany Harmony four-prong tapered pavé band.
begin()
n = 320
ts = [math.pi / 2 + 0.28 + (TAU - 0.56) * i / (n - 1) for i in range(n)]
points = [(1.28 * math.cos(t), 1.28 * math.sin(t), 0) for t in ts]
normals = [(math.cos(t), math.sin(t), 0) for t in ts]
widths = [0.102 - 0.029 * max(0, math.sin(t)) ** 4 for t in ts]
band = sweep('Tapered comfort band', points, normals, widths, [0.052] * n)
for side in (-1, 1):
    path = bezier((side * 0.354, 1.23, 0), (side * 0.33, 1.34, 0),
                  (side * 0.34, 1.44, 0), (side * 0.26, 1.47, 0))
    sweep('Cathedral shoulder', path, [(0, 1, 0)] * len(path),
          [0.071 - 0.02 * i / (len(path) - 1) for i in range(len(path))], [0.027] * len(path))

head = bpy.data.objects.new('Four prong head assembly', None); bpy.context.collection.objects.link(head)
head.location = xyz((0, 1.40, 0)); head['setting_head'] = True; objects.append(head)
def head_part(obj):
    obj.parent = head; obj.matrix_parent_inverse = head.matrix_world.inverted()
    # Parent inverse must use an updated translation before attaching geometry.
    obj.matrix_parent_inverse = Matrix.Translation(head.location).inverted()
    return obj
for i in range(4):
    angle = math.pi / 4 + i * math.pi / 2
    def p(r, y): return (r * math.cos(angle), y, r * math.sin(angle))
    path = bezier(p(0.11, 1.35), p(0.17, 1.43), p(0.37, 1.65), p(0.286, 1.712), 40)
    head_part(tube('Curved claw', path, 0.019, normal=(math.sin(angle), 0, -math.cos(angle))))
    head_part(sphere('Rounded claw tip', p(0.286, 1.712), 0.022))
    petal = bezier(p(0.10, 1.35), p(0.38, 1.39), p(0.34, 1.52), p(0.247, 1.567))
    head_part(tube('Open petal gallery', petal, 0.015, normal=(math.sin(angle), 0, -math.cos(angle))))
head_part(tube('Gallery bearing', [(0.244 * math.cos(TAU * i / 128), 1.561, 0.244 * math.sin(TAU * i / 128))
    for i in range(128)], 0.013, normal=(0, 1, 0), closed=True))
stone_slot('Center stone', (0, 1.63, 0), (0, 1, 0), (1, 0, 0), 1.10, 1.65, 0.25)
cutters = []
for side in (-1, 1):
    for i in range(9):
        t = math.pi / 2 + side * (0.34 + i * 0.13)
        normal = Vector((math.cos(t), math.sin(t), 0)); center = normal * 1.345
        stone_slot(f'Shoulder accent {side} {i}', center, normal, (0, 0, 1), 0.18, 0.30, 0.052, 'accent')
        cutters.append(sphere('Accent seat cutter', center, 0.057, cutter=True))
        for edge in (-1, 1):
            sphere('Pave grain', center + Vector((0, 0, edge * 0.061)) - normal * 0.003, 0.009)
carve_seats(band, cutters)
export('solitaire')

# The supplied close-up is asymmetric: three rails open around three silver beads on
# one side, then each continues separately to the same convergence point opposite it.
begin()
bead_ts = (math.radians(55), math.pi / 2, math.radians(125))
for i, t in enumerate(bead_ts):
    stone_slot(f'Silver bead {i + 1}', (1.30 * math.cos(t), 1.30 * math.sin(t), 0),
        (math.cos(t), math.sin(t), 0), (0, 0, 1), 1, 1, 0.31)

# Three individual closed rails meet only at the bottom point of the ring.
# No shared lower semicircle: separation remains visible on both lower sides.
rail_landmarks, bead_contacts, bead_triangles = [], [], []
for rail, phase in enumerate((math.pi / 2, -math.pi / 6, -5 * math.pi / 6)):
    paved = rail != 1
    def center_at(t):
        radial = Vector((math.cos(t), math.sin(t), 0))
        # sin(half-angle) has one zero per loop, at the opposite convergence point.
        # Full opening at all three beads; collapse only at the opposite point.
        spread = min(1, abs(math.sin((t + math.pi / 2) / 2)) / math.cos(math.radians(20)))
        phi = phase + 0.20 * math.cos(t)
        normal = radial * math.cos(phi) + Vector((0, 0, math.sin(phi)))
        return radial * 1.30 + normal * (0.335 * spread), normal, spread
    def rail_frame(t):
        center, normal, spread = center_at(t)
        tangent = (center_at(t + 0.0001)[0] - center_at(t - 0.0001)[0]).normalized()
        normal = (normal - tangent * normal.dot(tangent)).normalized()
        # Align the tiny joining sections, while the three centerlines stay separate.
        radial = Vector((math.cos(t), math.sin(t), 0))
        normal = (radial * (1 - spread) + normal * spread).normalized()
        normal = (normal - tangent * normal.dot(tangent)).normalized()
        return center, normal, tangent.cross(normal).normalized(), spread
    rail_landmarks.append([center_at(t)[0] for t in (-math.pi / 2, 0, math.pi)])
    bead_triangles.append([center_at(t)[0] for t in bead_ts])
    bead_contacts.append([dict(centerline_distance=(center_at(t)[0] - Vector((1.30 * math.cos(t), 1.30 * math.sin(t), 0))).length,
        surface_clearance=(center_at(t)[0] - Vector((1.30 * math.cos(t), 1.30 * math.sin(t), 0))).length - 0.025 - 0.31)
        for t in bead_ts])
    ts = [-math.pi / 2 + TAU * i / 512 for i in range(512)]
    frames = [rail_frame(t) for t in ts]
    band = sweep('Flat pave rail' if paved else 'Polished supporting rail',
        [f[0] for f in frames], [f[1] for f in frames],
        [0.014 + ((0.074 if paved else 0.043) - 0.014) * f[3] for f in frames],
        [0.025] * len(frames), True, flat=paved)
    cutters = []
    if paved:
        # Round lips remain visible around the open seats, like the supplied photo.
        for side in (-1, 1):
            edge = [f[0] + f[2] * (side * (0.009 + 0.060 * f[3])) + f[1] * 0.024 for f in frames]
            tube('Continuous pave rim', edge, 0.007, normal=(0, 0, 1), closed=True)
        # Carry the pavé down both sides, leaving only the tiny tapered join bare.
        samples = [-math.pi / 2 + 0.48 + (TAU - 0.96) * i / 1600 for i in range(1601)]
        sample_frames = [rail_frame(t) for t in samples]
        lengths = [0]
        for i in range(1, len(samples)):
            lengths.append(lengths[-1] + (sample_frames[i][0] - sample_frames[i - 1][0]).length)
        j, i, distance = 1, 0, 0
        while distance <= lengths[-1]:
            while j < len(lengths) - 1 and lengths[j] < distance: j += 1
            fraction = (distance - lengths[j - 1]) / max(1e-9, lengths[j] - lengths[j - 1])
            t = samples[j - 1] * (1 - fraction) + samples[j] * fraction
            center, normal, across, spread = rail_frame(t)
            half_width = 0.014 + 0.060 * spread
            gem_radius = min(0.0522, half_width - 0.012)
            size = gem_radius / 0.0522
            seat = center + normal * (0.025 + 0.009 * size)
            stone_slot(f'Rail stone {rail} {i}', seat, normal, across, 0.18 * size, 0.30 * size, gem_radius, 'accent')
            cutters.append(sphere('Rail seat cutter', seat, 0.057 * size, cutter=True))
            for side in (-1, 1):
                sphere('Rail pave grain', seat + across * (side * (gem_radius + 0.011 * size)) - normal * (0.006 * size), 0.008 * size)
            distance += 2 * gem_radius + 0.020
            i += 1
    carve_seats(band, cutters)
export('interlace')
def separation_at(index):
    return min((rail_landmarks[a][index] - rail_landmarks[b][index]).length
        for a in range(3) for b in range(a + 1, 3))
reports['interlace']['convergence'] = dict(
    rails=3, point=[0, -1.30, 0],
    max_centerline_gap_at_point=max((a[0] - b[0]).length for a in rail_landmarks for b in rail_landmarks),
    min_separation_at_right_side=separation_at(1), min_separation_at_left_side=separation_at(2),
    shared_semicircular_shank=False)
reports['interlace']['bead_support'] = dict(
    beads=3, cross_section='equilateral triangle', rail_phase_degrees=[90, -30, -150],
    rail_centerline_radius=0.335, bead_radius=0.31, rail_half_depth=0.025,
    maximum_contact_clearance=max(abs(p['surface_clearance']) for rail in bead_contacts for p in rail),
    maximum_triangle_edge_difference=max(
        max((bead_triangles[a][i] - bead_triangles[b][i]).length for a in range(3) for b in range(a + 1, 3))
        - min((bead_triangles[a][i] - bead_triangles[b][i]).length for a in range(3) for b in range(a + 1, 3))
        for i in range(3)),
    flat_pave_rails=2, fixed_accent_inlay='diamond')
assert reports['interlace']['main_slots'] == 3
assert reports['interlace']['bead_support']['maximum_contact_clearance'] < 1e-6
assert reports['interlace']['bead_support']['maximum_triangle_edge_difference'] < 1e-6
assert reports['interlace']['convergence']['max_centerline_gap_at_point'] < 1e-8
assert separation_at(1) > 0.40 and separation_at(2) > 0.40

# Verify the exported meshes' inner surfaces against every bead, including the
# planar faces, rounded supporting rail and cut gemstone seats.
bpy.context.view_layer.update()
beads = sorted([o for o in objects if o.get('inlay_slot') == 'main'], key=lambda o: o.name)
rails = sorted([o for o in objects if o.type == 'MESH' and
    (o.name.startswith('Flat pave rail') or o.name.startswith('Polished supporting rail'))], key=lambda o: o.name)
contact_report = []
for bead in beads:
    contacts = []
    for rail in rails:
        bvh = BVHTree.FromPolygons([rail.matrix_world @ v.co for v in rail.data.vertices],
            [p.vertices for p in rail.data.polygons])
        distance = bvh.find_nearest(bead.matrix_world.translation)[3]
        contacts.append(dict(rail=rail.name, distance=distance, silver_radius=bead['silver_radius'],
            clearance=distance - bead['silver_radius']))
    contact_report.append(dict(bead=bead.name, contacts=contacts))
reports['interlace']['bead_support']['actual_surface_contacts'] = contact_report
max_contact_error = max(abs(c['clearance']) for bead in contact_report for c in bead['contacts'])
reports['interlace']['bead_support']['maximum_actual_surface_contact_error'] = max_contact_error
assert len(rails) == 3 and len(beads) == 3 and max_contact_error < 0.0001

with open(os.path.join(ROOT, 'docs/mounting-validation.json'), 'w') as f:
    json.dump(reports, f, indent=2)
print(json.dumps(reports, indent=2))
