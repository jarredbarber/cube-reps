# Cube Reps

A zero-backend web tool for practicing 3D box drawing — fast. Draw a cube
edge-by-edge with an Apple Pencil, tap **Score**, and see the ideal cube your
lines were reaching for snapped on top. Built to get *reps* in, which is the
thing Procreate makes slow.

## The loop

1. Draw a cube, one pencil stroke per edge (~9–12 edges).
2. **Score** — the tool fits your strokes, finds the 3 vanishing points, and shows:
   - **Overlay (a):** the perspectively-exact ideal cube, ghosted in plotter-blue.
   - **Annotated edges (c):** each drawn edge recolored green→red by how far it
     drifts from converging, plus vanishing-point crosshairs and construction rays.
   - **Score (b):** a single 0–100 number to optimize (70% convergence, 30% straightness).
3. **Keep** freezes the rep to a practice sheet (with its score) and starts a fresh
   one beside it. **Undo** pops the last kept rep back. **Wipe** clears the current
   cube; **Clear sheet** clears everything.

## How it works

All geometry is in `geom.js` (no DOM, Node-testable):

- **Line fit** — PCA/total-least-squares per stroke → direction, length, wobble.
- **Family grouping** — k-means in *vanishing-point space* (not raw angle, which
  merges the two near-horizontal cube families). Each edge joins the VP it best
  aims at; VPs refit; repeat, with seeded restarts.
- **Vanishing points** — least-squares line intersection per family; near-parallel
  families resolve to a direction at infinity (2-point perspective).
- **Ideal cube overlay (Option C)** — infer topology (cluster endpoints into shared
  corners → cube graph), anchor at the front corner, snap its neighbors onto the VP
  rays, then *construct* the remaining corners by forced ray intersections. A fit
  guard rejects bad topology and falls back to **Option B** (snapped straight edges,
  no perspective correction) so the overlay degrades instead of lying.

### Known ceiling

A sparse (~3-edge) family lets its vanishing point overfit those same lines, so the
score is forgiving/compressed. Monotonic (worse cubes score lower), which is all v1
needs. Upgrade path: jointly fit the 3 VPs under a closed-cube constraint.

## Run / deploy

Static files, no build step. Locally:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Deploy = push the directory to Cloudflare Pages or GitHub Pages. (Needs Safari /
WebKit for Apple Pencil pressure + tilt; works offline once loaded.)

## Test

```sh
node test_geom.mjs
```

Checks: a clean cube scores ~100, noisy/wobbly cubes score lower, and the overlay
round-trips a ground-truth cube (with a fallback case for non-cube input).

## Not built yet (YAGNI until the loop proves worth it)

Trace mode, dedicated measure tool, daily challenge, persistence. The overlay's
score ceiling (Option C joint-fit) is the most likely first upgrade.
