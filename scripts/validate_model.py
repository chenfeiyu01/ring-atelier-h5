"""Check the turning channel topology, closed back, open face and bead clearance."""
import bpy, bmesh, json, math, os
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'models/ring.blend'))
gold=next(o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('Gold shank'))
beads=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('Silver bead')]
bm=bmesh.new();bm.from_mesh(gold.data)
non_manifold=sum(not e.is_manifold for e in bm.edges)
assert non_manifold==0, f'Gold has {non_manifold} non-manifold edges'
bm.free();bpy.context.view_layer.update()
bvh=BVHTree.FromObject(gold,bpy.context.evaluated_depsgraph_get())
def convert(p):return Vector((p.x,-p.z,p.y))
back_distances=[]
for i in range(360):
    t=i*2*math.pi/360;alpha=t-math.pi/2+0.25
    radial=Vector((math.cos(t),math.sin(t),0));depth=Vector((0,0,1))
    opening=convert(radial*math.cos(alpha)+depth*math.sin(alpha))
    center=convert(radial*1.30)
    point,normal,face,dist=bvh.ray_cast(center,-opening,0.4)
    assert point is not None, f'Missing channel back at angle {t}'
    assert abs(dist-0.205)<0.001, f'Unexpected backing position {dist}'
    back_distances.append(dist)
    point,normal,face,dist=bvh.ray_cast(center,opening,0.4)
    assert point is None, f'Channel opening obstructed at angle {t}'
assert len(beads)==20, f'Expected 20 beads, got {len(beads)}'
bead_radius=beads[0].dimensions.x/2
min_neighbor_gap=min((a.location-b.location).length-a.dimensions.x/2-b.dimensions.x/2 for i,a in enumerate(beads) for b in beads[i+1:])
assert min_neighbor_gap>0, f'Beads intersect: {min_neighbor_gap}'
min_clearance=100;penetrations=0;sample_count=0
for bead in beads:
    for vert in list(bead.data.vertices)[::4]:
        p=bead.matrix_world@vert.co
        q,n,face,dist=bvh.find_nearest(p)
        signed=(p-q).dot(n);sample_count+=1
        if signed < -0.0002:penetrations+=1
        min_clearance=min(min_clearance,signed)
assert not penetrations, f'{penetrations} sampled bead points are inside gold'
report={'gold_non_manifold_edges':non_manifold,'closed_back_rays':len(back_distances),'unobstructed_open_face_rays':360,'back_distance_min':min(back_distances),'back_distance_max':max(back_distances),'bead_count':len(beads),'bead_radius':bead_radius,'minimum_neighbor_gap':min_neighbor_gap,'sampled_bead_points':sample_count,'sampled_bead_penetrations':penetrations,'minimum_sampled_bead_clearance':min_clearance,'gold_vertices':len(gold.data.vertices),'gold_polygons':len(gold.data.polygons),'units':'arbitrary relative units; no source CAD dimensions','note':'Closed back rotates with the open channel; no fixed cylindrical liner. These checks do not establish exact reference fidelity or manufacturing readiness.'}
with open(os.path.join(ROOT,'docs/model-validation.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps(report,indent=2))
