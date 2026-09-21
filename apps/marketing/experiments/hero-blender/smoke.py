"""Headless smoke test: import the real GLB, frame it, render one Cycles CPU frame."""
import bpy, sys, time, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 32

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
t_import = time.time() - t0

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tris = sum(len(o.data.loop_triangles) if o.data.loop_triangles else
           sum(max(0, len(p.vertices) - 2) for p in o.data.polygons) for o in meshes)

# Strip the Sketchfab studio backdrop (56% of the triangles, not the handset).
STRIP = {'Plane013_metaL001_0', 'Plane014_metaL001_0'}
removed = [o.name for o in meshes if o.name in STRIP]
for name in removed:
    bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Report every mesh + material so orientation and the screen mesh are FACTS, not guesses.
report = []
for o in meshes:
    o.data.calc_loop_triangles()
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    report.append((o.name, len(o.data.loop_triangles),
                   [round(v, 3) for v in (hi - lo)],
                   [m.name for m in o.data.materials if m]))

screen = next((o for o in meshes if any('screen' in (m.name or '').lower()
                                        for m in o.data.materials if m)), None)

# Where does the screen face? Average its world-space normals — a fact, not a guess.
facing = None
if screen:
    screen.data.calc_loop_triangles()
    n = Vector((0, 0, 0))
    mw = screen.matrix_world.to_3x3()
    for t in screen.data.loop_triangles:
        n += (mw @ t.normal) * t.area
    if n.length > 0:
        n.normalize()
        facing = [round(v, 3) for v in n]

print("=== HEADLESS BLENDER SMOKE TEST ===")
print(f"import        : {t_import:.2f}s")
print(f"triangles     : {tris} -> {sum(r[1] for r in report)} after stripping {removed}")
print(f"screen mesh   : {screen.name if screen else 'NOT FOUND'}")
print(f"screen normal : {facing}   (world space; +Z is up in Blender, -Y is 'front')")
print("meshes (top 8 by tris):")
for r in sorted(report, key=lambda r: -r[1])[:8]:
    print(f"   {r[0]:<34} {r[1]:>6}t  size={r[2]}  mats={r[3]}")

# Frame the whole thing from the direction the screen actually faces.
allbb = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(v.x for v in allbb), min(v.y for v in allbb), min(v.z for v in allbb)))
hi = Vector((max(v.x for v in allbb), max(v.y for v in allbb), max(v.z for v in allbb)))
centre, size = (lo + hi) / 2, (hi - lo)

cam_data = bpy.data.cameras.new("Cam"); cam_data.lens = 85
cam = bpy.data.objects.new("Cam", cam_data); bpy.context.scene.collection.objects.link(cam)
d = max(size) * 2.6
dirv = Vector(facing) if facing else Vector((0, -1, 0))
cam.location = centre + dirv * d
look = (centre - cam.location).normalized()
cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam

sun = bpy.data.objects.new("Key", bpy.data.lights.new("Key", 'AREA'))
sun.data.energy = 2000; sun.data.size = max(size) * 3
sun.location = centre + Vector((-d * .6, -d * .6, d * .8))
sun.rotation_euler = (centre - sun.location).normalized().to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.collection.objects.link(sun)

w = bpy.data.worlds.new("W"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (1.0, 0.980, 0.918, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.2
bpy.context.scene.world = w

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 800, 1000
sc.render.film_transparent = False
sc.render.filepath = OUT
sc.render.image_settings.file_format = 'PNG'

t1 = time.time()
bpy.ops.render.render(write_still=True)
print(f"render        : {time.time() - t1:.2f}s at 800x1000, {SAMPLES} samples, Cycles CPU, denoised")
print(f"wrote         : {OUT}")
