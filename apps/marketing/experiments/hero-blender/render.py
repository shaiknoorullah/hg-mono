"""Render the handset with our UI on its screen. Headless, Cycles CPU."""
import bpy, sys, time, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
GLB, UI, OUTDIR, FRAMES, SAMPLES = a[0], a[1], a[2], int(a[3]), int(a[4])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

def mats(o): return [m for m in o.data.materials if m]
def by_mat(frag): return [o for o in bpy.data.objects if o.type == 'MESH'
                          and any(frag in (m.name or '').lower() for m in mats(o))]
def centre(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return sum(bb, Vector()) / 8

# 1. Strip the Sketchfab studio backdrop — 29,040 tris of floor and wall.
for name in ('Plane.013_metaL.001_0', 'Plane.014_metaL.001_0'):
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)

# 2a. Recolour the chassis to the brand's own ink so the device matches the
#     handsets drawn in the G-series artboards. Titanium reads warm against
#     cream and competes with it; near-black recedes and lets the screen lead.
BODY   = (0.0185, 0.0185, 0.0185, 1)   # #232323 in linear-ish terms
RAIL   = (0.0120, 0.0120, 0.0130, 1)   # the side rail, a shade deeper
def repaint(frag, rgba, metallic, rough):
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        for m in mats(o):
            if frag not in (m.name or '').lower(): continue
            m.use_nodes = True
            b = m.node_tree.nodes.get('Principled BSDF')
            if not b: continue
            b.inputs['Base Color'].default_value = rgba
            b.inputs['Metallic'].default_value = metallic
            b.inputs['Roughness'].default_value = rough
repaint('basecolor', BODY, 0.55, 0.36)      # the glass back
repaint('metalframe', RAIL, 1.00, 0.22)     # the brushed rail
repaint('metal', RAIL, 1.00, 0.30)          # any remaining metal trim

# 2b. The Apple logo fills a CUT-OUT in the back panel, so deleting it leaves a
#     hole. Repaint it to the chassis colour instead: the mark goes, the panel stays.
logo = next((o for o in bpy.data.objects if o.type == 'MESH' and 'logo' in o.name.lower()), None)
if logo:
    m = bpy.data.materials.new('blanked'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = BODY
    b.inputs['Metallic'].default_value = 0.55
    b.inputs['Roughness'].default_value = 0.36
    logo.data.materials.clear(); logo.data.materials.append(m)

# 3. Our UI onto the screen material, emissive so it reads as a lit display.
screen = by_mat('screen')[0]
sm = mats(screen)[0]
sm.use_nodes = True
nt = sm.node_tree
for n in list(nt.nodes):
    if n.type != 'OUTPUT_MATERIAL': nt.nodes.remove(n)
out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
img = nt.nodes.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(UI)
img.image.colorspace_settings.name = 'sRGB'
uvmap = nt.nodes.new('ShaderNodeUVMap')
flip = nt.nodes.new('ShaderNodeMapping')
flip.inputs['Location'].default_value = (1.0, 1.0, 0.0)
flip.inputs['Scale'].default_value = (-1.0, -1.0, 1.0)   # Y: glTF/Blender UV origin. X: this mesh's UVs are mirrored.
nt.links.new(uvmap.outputs['UV'], flip.inputs['Vector'])
nt.links.new(flip.outputs['Vector'], img.inputs['Vector'])
emi = nt.nodes.new('ShaderNodeEmission'); emi.inputs['Strength'].default_value = 1.35
nt.links.new(img.outputs['Color'], emi.inputs['Color'])
nt.links.new(emi.outputs['Emission'], out.inputs['Surface'])

# 4. Facing: the screen sits on the opposite side of the chassis from the back
#    panel. Averaged normals cancel on a thin box, so this relationship is used.
back = by_mat('basecolor')[0]
v = centre(screen) - centre(back)
axis = max(range(3), key=lambda i: abs(v[i]))
facing = Vector((0, 0, 0)); facing[axis] = 1.0 if v[axis] > 0 else -1.0

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bb = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb)))
hi = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
centre_all, size = (lo + hi) / 2, (hi - lo)

pivot = bpy.data.objects.new("Pivot", None)
bpy.context.scene.collection.objects.link(pivot)
for o in meshes:
    if o.parent is None: o.parent = pivot
pivot.location = -centre_all

cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 95
cam = bpy.data.objects.new("Cam", cam_d); bpy.context.scene.collection.objects.link(cam)
dist = max(size) * 3.15   # the whole handset in frame, with air
cam.location = facing * dist
cam.rotation_euler = (-cam.location).normalized().to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam

def area(name, loc, energy, sz):
    L = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
    L.data.energy = energy; L.data.size = sz
    L.location = Vector(loc) * dist
    L.rotation_euler = (-L.location).normalized().to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(L)
area("Key",  (-0.9,  -0.55, 0.85), 3000, max(size) * 3)
area("Fill", ( 0.95, -0.35, 0.10),  700, max(size) * 4)
area("Rim",  ( 0.2,   0.95, 0.55), 2600, max(size) * 2)

w = bpy.data.worlds.new("W"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (1.0, 0.980, 0.918, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
bpy.context.scene.world = w

sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 720, 960
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'Standard'   # keep the cream exactly #FFFAEA

print(f"facing axis {axis} sign {facing[axis]:+.0f} | screen {screen.name} | tris "
      f"{sum(len(o.data.loop_triangles) for o in meshes if o.data.calc_loop_triangles() is None)}")
t0 = time.time()
for i in range(FRAMES):
    p = 0 if FRAMES == 1 else i / (FRAMES - 1)
    pivot.rotation_euler = (0, 0, math.radians(-26 + p * 52))
    sc.render.filepath = f"{OUTDIR}/f{i:03d}.png"
    bpy.ops.render.render(write_still=True)
    print(f"  frame {i+1}/{FRAMES}  {time.time()-t0:.1f}s elapsed", flush=True)
print(f"TOTAL {time.time()-t0:.1f}s for {FRAMES} frames")
