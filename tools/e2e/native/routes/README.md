# Device-lab GPX routes

Routes on the devworld map that a mission plays on the emulator's GPS with `geo-route:` (one fix
per second, longitude first: [../../reality/README.md](../../reality/README.md)). They are
generated: edit [`build-routes.mjs`](build-routes.mjs), then run
`node tools/e2e/native/routes/build-routes.mjs`. CI fails when a file differs from its generator.

| Route | From → to | Use |
|---|---|---|
| `restaurant-to-amina.gpx` | Bismillah Grill, 1240 Danforth Ave → Amina's home pin | Dropoff leg, about 45 s |
| `rider-to-restaurant.gpx` | 300 m north (devworld `shortStart`) → Bismillah Grill | Pickup leg, the `route=short` journey, about 70 s |
| `rider-long-stall.gpx` | devworld `longStart` → `longBend` → Bismillah Grill | The `route=long` journey with **no fix for 120 s** at the bend, past dispatch's 90 s freshness window, about 7 min |

The points are the ones in `services/hg/internal/devworld/route.go` and `catalogue.go`, so the
emulator's position matches what the API knows.

**The stall caveat.** A gap in the GPX stops new fixes, but the emulator may keep reporting the
last one, and the app keeps posting it. To make the server's fix really go stale, pair the stall
with `network: offline` (or `airplane: on`) for its length, or background the app.
