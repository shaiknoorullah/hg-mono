import bpy, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])

def centre(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return sum(bb, Vector()) / 8

def by_mat(frag):
    return [o for o in bpy.data.objects if o.type == 'MESH'
            and any(frag in (m.name or '').lower() for m in o.data.materials if m)]

screen = by_mat('screen')
back   = by_mat('basecolor')      # the rear panel
frame  = by_mat('metalframe')
print("screen meshes  :", [o.name for o in screen])
print("back meshes    :", [o.name for o in back])
if screen and back:
    v = centre(screen[0]) - centre(back[0])
    print("screen - back  :", [round(x, 4) for x in v], "-> facing axis:",
          max(range(3), key=lambda i: abs(v[i])), "sign:", 1 if v[max(range(3), key=lambda i: abs(v[i]))] > 0 else -1)
# largest single face of the screen, which cannot cancel
if screen:
    s = screen[0]; s.data.calc_loop_triangles()
    mw = s.matrix_world.to_3x3()
    big = max(s.data.loop_triangles, key=lambda t: t.area)
    print("largest face n :", [round(x, 3) for x in (mw @ big.normal).normalized()], "area", round(big.area, 5))
# what the backdrop planes are really called after the glTF importer renames
print("all mesh names :", sorted(o.name for o in bpy.data.objects if o.type == 'MESH')[:6], "...")
