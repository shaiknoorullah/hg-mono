"""
Trace the supplied Halalgoes wordmark PNG to SVG paths.

No potrace / numpy in this container, so this is a small, purpose-built tracer:

  1. marching squares on the ALPHA channel with linear edge interpolation, so
     contours land on the anti-aliased half-coverage isoline rather than on
     integer pixel corners (sub-pixel accurate, no staircase),
  2. Ramer-Douglas-Peucker to drop collinear runs,
  3. Schneider cubic fitting (Graphics Gems) so the curves stay curves when the
     mark is scaled past its 556px source.

Contours are emitted with fill-rule="evenodd" ON PURPOSE: that makes counter
shapes (the bowls of a, o, e, the eye of g) work without having to reason about
winding direction, which is the part of a hand-rolled tracer that goes wrong.
"""
import math
from PIL import Image

import os
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "halalgoes-wordmark-supplied.png")
LEVEL = 127.3          # not 127.5: keeps a corner from landing exactly on the level
# The supplied artwork paints the swash with ONE vertical linear gradient, not a
# flat fill. Measured on the 572 fully-interior blend pixels: orangeness rises
# dead-linearly with y, with no x term, hitting 0 at y=119.5 and 1 at y=154.9.
# So the split is not a colour threshold but "is this pixel ON that ramp" — which
# is what lets the traced swash run ABOVE the ramp (to y=118.2), where it is pure
# letterform colour and the handoff into the g descender has no seam.
G0, G1 = 119.5, 154.9


def load():
    """-> (W, H, silhouette alpha field, swash alpha field)."""
    im = Image.open(SRC).convert("RGBA")
    W, H = im.size
    px = im.load()
    sil = [[0.0] * W for _ in range(H)]
    swash = [[0.0] * W for _ in range(H)]
    for y in range(H):
        ramp = max(0.0, min(1.0, (y - G0) / (G1 - G0)))
        cut = max(0.03, 0.5 * ramp)
        for x in range(W):
            r, g, b, a = px[x, y]
            if a <= 8:            # ~1940 px of sub-1% dust around the edges
                continue
            sil[y][x] = float(a)
            if max(0.0, min(1.0, (r - b) / 205.0)) >= cut:
                swash[y][x] = float(a)
    return W, H, sil, swash


def field(grid, W, H):
    """Pad with a ring of zeros so every contour closes inside the grid."""
    f = [[0.0] * (W + 2) for _ in range(H + 2)]
    for y in range(H):
        for x in range(W):
            f[y + 1][x + 1] = grid[y][x]
    return f, W + 2, H + 2


def marching_squares(f, W, H, level=LEVEL):
    """Return closed loops of (x, y) in padded coords."""
    segs = {}      # edge-id -> point
    links = []     # (edge-id, edge-id)

    def interp(v0, v1):
        d = v1 - v0
        return 0.5 if abs(d) < 1e-9 else (level - v0) / d

    for y in range(H - 1):
        for x in range(W - 1):
            a = f[y][x]; b = f[y][x + 1]; c = f[y + 1][x + 1]; d = f[y + 1][x]
            case = (1 if a >= level else 0) | (2 if b >= level else 0) | \
                   (4 if c >= level else 0) | (8 if d >= level else 0)
            if case == 0 or case == 15:
                continue
            T = ('H', x, y); B = ('H', x, y + 1); L = ('V', x, y); R = ('V', x + 1, y)
            if T not in segs: segs[T] = (x + interp(a, b), float(y))
            if B not in segs: segs[B] = (x + interp(d, c), float(y + 1))
            if L not in segs: segs[L] = (float(x), y + interp(a, d))
            if R not in segs: segs[R] = (float(x + 1), y + interp(b, c))

            if case in (1, 14):   pairs = [(T, L)]
            elif case in (2, 13): pairs = [(T, R)]
            elif case in (3, 12): pairs = [(L, R)]
            elif case in (4, 11): pairs = [(R, B)]
            elif case in (6, 9):  pairs = [(T, B)]
            elif case in (7, 8):  pairs = [(L, B)]
            elif case == 5:
                centre = (a + b + c + d) / 4.0
                pairs = [(T, R), (B, L)] if centre >= level else [(T, L), (R, B)]
            elif case == 10:
                centre = (a + b + c + d) / 4.0
                pairs = [(T, L), (R, B)] if centre >= level else [(T, R), (L, B)]
            else:
                pairs = []
            links.extend(pairs)

    adj = {}
    for u, v in links:
        adj.setdefault(u, []).append(v)
        adj.setdefault(v, []).append(u)

    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        # only start where the walk can actually close
        loop, cur, prev = [], start, None
        while cur is not None and cur not in seen:
            seen.add(cur)
            loop.append(segs[cur])
            nxt = None
            for cand in adj.get(cur, ()):
                if cand != prev and cand not in seen:
                    nxt = cand
                    break
            prev, cur = cur, nxt
        if len(loop) >= 4:
            loops.append(loop)
    return loops


def rdp(pts, eps):
    if len(pts) < 3:
        return pts[:]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        x0, y0 = pts[i]; x1, y1 = pts[j]
        dx, dy = x1 - x0, y1 - y0
        n = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px_, py_ = pts[k]
            dist = (abs(dy * px_ - dx * py_ + x1 * y0 - y1 * x0) / n) if n > 1e-12 \
                   else math.hypot(px_ - x0, py_ - y0)
            if dist > best:
                best, bi = dist, k
        if best > eps:
            keep[bi] = True
            stack.append((i, bi)); stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


# ---------------------------------------------------------------- bezier fit
def v_sub(a, b): return (a[0] - b[0], a[1] - b[1])
def v_add(a, b): return (a[0] + b[0], a[1] + b[1])
def v_scale(a, s): return (a[0] * s, a[1] * s)
def v_dot(a, b): return a[0] * b[0] + a[1] * b[1]
def v_norm(a):
    n = math.hypot(a[0], a[1])
    return (0.0, 0.0) if n < 1e-12 else (a[0] / n, a[1] / n)


def bezier_at(bez, t):
    mt = 1 - t
    return (
        bez[0][0] * mt ** 3 + 3 * bez[1][0] * mt * mt * t + 3 * bez[2][0] * mt * t * t + bez[3][0] * t ** 3,
        bez[0][1] * mt ** 3 + 3 * bez[1][1] * mt * mt * t + 3 * bez[2][1] * mt * t * t + bez[3][1] * t ** 3,
    )


def chord_params(pts):
    u = [0.0]
    for i in range(1, len(pts)):
        u.append(u[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    total = u[-1] or 1.0
    return [v / total for v in u]


def generate_bezier(pts, u, t1, t2):
    """Least-squares fit of one cubic to pts with fixed end tangents."""
    n = len(pts)
    A = []
    for i in range(n):
        t = u[i]; mt = 1 - t
        A.append((v_scale(t1, 3 * mt * mt * t), v_scale(t2, 3 * mt * t * t)))
    c00 = c01 = c11 = x0 = x1 = 0.0
    p0, p3 = pts[0], pts[-1]
    for i in range(n):
        a0, a1 = A[i]
        c00 += v_dot(a0, a0); c01 += v_dot(a0, a1); c11 += v_dot(a1, a1)
        t = u[i]; mt = 1 - t
        base = v_add(v_scale(p0, mt ** 3 + 3 * mt * mt * t), v_scale(p3, 3 * mt * t * t + t ** 3))
        tmp = v_sub(pts[i], base)
        x0 += v_dot(a0, tmp); x1 += v_dot(a1, tmp)
    det = c00 * c11 - c01 * c01
    if abs(det) > 1e-12:
        alpha0 = (x0 * c11 - x1 * c01) / det
        alpha1 = (c00 * x1 - c01 * x0) / det
    else:
        alpha0 = alpha1 = 0.0
    seg = math.hypot(p3[0] - p0[0], p3[1] - p0[1])
    if alpha0 < 1e-6 or alpha1 < 1e-6:       # degenerate -> Wu/Barsky heuristic
        alpha0 = alpha1 = seg / 3.0
    return [p0, v_add(p0, v_scale(t1, alpha0)), v_add(p3, v_scale(t2, alpha1)), p3]


def max_error(pts, bez, u):
    worst, idx = 0.0, len(pts) // 2
    for i in range(1, len(pts) - 1):
        p = bezier_at(bez, u[i])
        d = (p[0] - pts[i][0]) ** 2 + (p[1] - pts[i][1]) ** 2
        if d > worst:
            worst, idx = d, i
    return math.sqrt(worst), idx


def reparam(pts, bez, u):
    out = []
    for i, t in enumerate(u):
        mt = 1 - t
        d1 = v_add(v_add(v_scale(v_sub(bez[1], bez[0]), 3 * mt * mt),
                         v_scale(v_sub(bez[2], bez[1]), 6 * mt * t)),
                   v_scale(v_sub(bez[3], bez[2]), 3 * t * t))
        d2 = v_add(v_scale(v_sub(v_add(bez[2], v_scale(bez[1], -2)), v_scale(bez[0], -1)), 6 * mt),
                   v_scale(v_sub(v_add(bez[3], v_scale(bez[2], -2)), v_scale(bez[1], -1)), 6 * t))
        q = v_sub(bezier_at(bez, t), pts[i])
        den = v_dot(d1, d1) + v_dot(q, d2)
        out.append(t if abs(den) < 1e-12 else t - v_dot(q, d1) / den)
    return out


def fit_cubic(pts, t1, t2, tol, depth=0):
    if len(pts) == 2:
        d = math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / 3.0
        return [[pts[0], v_add(pts[0], v_scale(t1, d)), v_add(pts[1], v_scale(t2, d)), pts[1]]]
    u = chord_params(pts)
    bez = generate_bezier(pts, u, t1, t2)
    err, idx = max_error(pts, bez, u)
    if err < tol:
        return [bez]
    if err < tol * tol and depth < 24:
        for _ in range(12):
            u = reparam(pts, bez, u)
            bez = generate_bezier(pts, u, t1, t2)
            err, idx = max_error(pts, bez, u)
            if err < tol:
                return [bez]
    if depth > 28 or idx <= 0 or idx >= len(pts) - 1:
        return [bez]
    centre = v_norm(v_sub(pts[idx - 1], pts[idx + 1]))
    left = fit_cubic(pts[:idx + 1], t1, centre, tol, depth + 1)
    right = fit_cubic(pts[idx:], (-centre[0], -centre[1]), t2, tol, depth + 1)
    return left + right


def fit_loop(pts, tol):
    """Closed loop: start the fit at the sharpest vertex so corners stay corners."""
    if len(pts) < 4:
        return []
    best, bi = 9.9, 0
    n = len(pts)
    for i in range(n):
        a = v_norm(v_sub(pts[i], pts[(i - 1) % n]))
        b = v_norm(v_sub(pts[(i + 1) % n], pts[i]))
        d = v_dot(a, b)
        if d < best:
            best, bi = d, i
    pts = pts[bi:] + pts[:bi]
    pts = pts + [pts[0]]
    t1 = v_norm(v_sub(pts[1], pts[0]))
    t2 = v_norm(v_sub(pts[-2], pts[-1]))
    return fit_cubic(pts, t1, t2, tol)


def to_path(curves, nd=2):
    if not curves:
        return ""
    r = lambda v: f"{round(v, nd):g}"
    d = [f"M{r(curves[0][0][0])} {r(curves[0][0][1])}"]
    for c in curves:
        d.append(f"C{r(c[1][0])} {r(c[1][1])} {r(c[2][0])} {r(c[2][1])} {r(c[3][0])} {r(c[3][1])}")
    d.append("Z")
    return "".join(d)




def build(mask, W, H, rdp_eps=0.18, fit_tol=0.45, min_area=6.0):
    f, PW, PH = field(mask, W, H)
    loops = marching_squares(f, PW, PH)
    out, dropped = [], 0
    for loop in loops:
        loop = [(x - 1.0, y - 1.0) for (x, y) in loop]       # undo the pad
        area, n = 0.0, len(loop)
        for i in range(n):
            x0, y0 = loop[i]; x1, y1 = loop[(i + 1) % n]
            area += x0 * y1 - x1 * y0
        area = abs(area) / 2.0
        if area < min_area:       # brush-edge specks, not shapes
            dropped += 1
            continue
        curves = fit_loop(rdp(loop, rdp_eps), fit_tol)
        if curves:
            out.append((area, curves))
    out.sort(key=lambda t: -t[0])
    return out, len(loops), dropped


# The script H ends, and the swash begins, either side of x=135 — the two never
# overlap horizontally. That is what lets the monogram be SELECTED out of the
# trace rather than drawn separately: the icon is the logo's own H, not a new H.
MONOGRAM_MAX_X = 135.0


if __name__ == "__main__":
    W, H, sil, swash = load()
    print(f"source {W}x{H}")
    emitted = {}
    for name, mask in (("silhouette", sil), ("swash", swash)):
        res, total, dropped = build(mask, W, H)
        emitted[name] = "".join(to_path(c) for _, c in res)
        print(f"  {name:11s} loops={total:3d} kept={len(res):3d} specks dropped={dropped:3d} "
              f"cubics={sum(len(c) for _, c in res):4d} bytes={len(emitted[name])}")
        if name == "silhouette":
            mono = [c for _, c in res
                    if max(p[0] for cu in c for p in cu) < MONOGRAM_MAX_X]
            emitted["monogram"] = "".join(to_path(c) for c in mono)
            print(f"  {'monogram':11s} subpaths={len(mono)} (of {len(res)}) "
                  f"bytes={len(emitted['monogram'])}")
    print()
    print(f"viewBox 0 0 {W} {H}   gradient y {G0} -> {G1}")
    print("Paste each `d` into src/components/Wordmark.tsx.")
    for name, d in emitted.items():
        with open(f"{name}.path", "w") as fh:
            fh.write(d)
        print(f"  wrote {name}.path")
