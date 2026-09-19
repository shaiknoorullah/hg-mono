# Hero renders — headless Blender

**Status: experiment. Nothing here ships.** Outside `src/` and `public/`, so Next never builds it.

Companion to `../hero-flipbook/`, which proves the frames-scrubbed-on-scroll delivery.
This proves the other half: rendering those frames at a quality three.js on
SwiftShader cannot reach.

## Why Blender, given the flipbook already worked

The flipbook renders through headless Chromium + three.js at 43 ms/frame, which is
right for iterating on layout. It cannot do brushed metal, a brass ring catching a
raking light, or a glass back — and those are the whole reason to use a real device
model rather than a drawn one. Cycles can.

| | headless Chromium + three.js | headless Blender + Cycles CPU |
|---|---|---|
| per frame | 43 ms | ~6.5 s @ 720×960, 32 samples, denoised, 4 cores |
| 60 frames | 2.5 s | ~6.5 min |
| materials | flat, approximate | measured PBR, real specular response |

Use three.js to find the composition, Blender for the frames that ship.

## Install (not preinstalled)

```bash
curl -sSfL -o /tmp/blender.tar.xz \
  https://download.blender.org/release/Blender4.5/blender-4.5.14-linux-x64.tar.xz
mkdir -p /opt/blender && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1
/opt/blender/blender --version     # 4.5.14 LTS; needs no display server
```

Runs `--background` with no GPU. 4.5 LTS is well inside glibc 2.39 (Ubuntu 24.04).

## Run

```bash
python3 screen-ui.py screen-ui.png
/opt/blender/blender --background --factory-startup -noaudio \
  --python render.py -- model.glb screen-ui.png out/ 60 32
```

`facing.py` and `smoke.py` are diagnostics — run them on any new model first.

## What this cost to learn, so nobody relearns it

Four things about this model were only discoverable by measuring:

1. **56% of the triangles are not the phone.** `Plane.013_metaL.001_0` and
   `Plane.014_metaL.001_0` are a Sketchfab studio floor and backdrop — 29,040 of
   51,520 triangles. Stripped, the handset is 22,480.
2. **The screen faces −X, and averaged normals will not tell you that.** The screen
   is a thin *box*; averaging its face normals nearly cancels, and the largest face
   reports `+X` — the inward one. What is reliable is the relationship:
   `centre(screen) − centre(back panel)` gives `[−0.044, 0, 0]`. Three separate
   bounding-box heuristics in the three.js version got this wrong before Blender
   made it measurable.
3. **The Apple logo fills a cut-out.** Delete the mesh and the background shows
   through the hole. It has to be repainted to the chassis colour, not removed.
4. **The screen UVs are mirrored in X**, on top of the usual glTF/Blender Y-origin
   flip. `screen-ui.py` pre-mirrors the texture; `render.py` does the Y flip.

## Model and attribution

Not committed — supply your own GLB. The one used in development:

> This work is based on ["iPhone 16 Pro Max"](https://sketchfab.com/3d-models/iphone-16-pro-max-41a071ae12794b668502f58d1e0fd1a3)
> by [MajdyModels](https://sketchfab.com/MG990) licensed under
> [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/)

CC-BY also requires that changes be indicated. Ours: studio backdrop geometry
removed, the Apple logo repainted to the chassis colour, and the chassis recoloured
to `#232323`. **That credit must appear in the site footer before any render using
this model ships.**

Separately, and not settled by the licence: Apple's Marketing Resources and Identity
Guidelines list "rendering in 3D or creating any simulation of an Apple product"
among unauthorized uses. The artist's CC-BY grant covers their mesh, not Apple's
design rights. Using it is a business-risk decision the client took knowingly.
