# Handoff: Cube Reps v1
Date: 2026-06-18

## Context

**Cube Reps** — Apple Pencil practice tool for learning 3D box drawing. Live at https://jarredbarber.github.io/cube-reps/

### Goal
Ship a fast iteration tool: draw cube edge-by-edge, get instant feedback (overlay + score), repeat. Get *reps* in without Procreate's friction. User testing on iPad imminent.

### Key files
- `geom.js` — core geometry: PCA line fit, VP-space k-means grouping, vanishing points, closed-form cube reconstruction with snapped-corner fallback
- `app.js` — Pointer Events input, draw/score/keep loop, animated feedback reveal, trace mode UI
- `index.html/style.css` — drafting-paper UI (plotter blue, monospace type, big score)
- `test_geom.mjs` — self-check: scoring monotonicity, overlay round-trip, generated cube validity

### Recent context from advisor
Grouping doesn't hold on real hand-drawn cubes (mislabels edges) but pencil input is fluid. Built tap-to-reassign escape hatch (finger taps an edge after Score to cycle its family, re-scores live). This addresses the #1 pain point user reported.

## Recent actions

1. **Tap-to-reassign** — after Score, finger-tap a mis-colored edge cycles its family (manual override). Addresses real-world grouping failures.
2. **Trace mode v1** — random 2D-faked cubes. User said "not enough angle" — wanted real rotation variety.
3. **Trace mode v2 (just shipped)** — replaced 2D faking with 3D cube + random yaw/pitch rotation → genuine orientation variety. VPs derived from axis directions (verified: edges converge to them). Vanishing lines drawn under the faint cube so user can see the perspective structure being practiced.

Test results: 300/300 generated cubes land on-canvas, 13 distinct orientation buckets (real rotation spread).

## Next steps

1. **iPad testing** — User draws real cubes, checks:
   - Does pencil feel fluid? (Predicted yes, already confirmed in conversation)
   - Does family grouping hold? When it fails, does tap-to-reassign fix it intuitively?
   - Does Option C (ideal cube overlay) fire often, or fall back to B (snapped-straight)?
   - Does trace mode feel useful for learning?

2. **If grouping keeps failing** — tighten corner-clustering tolerance or loosen reconstruction fit guard. Alternatively, validate/fix topology inference (currently stops at first anchor corner; could be stricter).

3. **If Option C rarely fires even with correct grouping** — corner topology is the issue (edges overshoot corners instead of meeting). Would need intersection-based corner detection, but mark this for v1.1 (don't build blind).

4. **If trace mode doesn't stick** — add difficulty modes (easier: larger cubes, gentler angles; harder: tiny, extreme), or a daily challenge (same random seed each day for scoring across reps). For v1, vanilla is fine.

### Known ceilings (documented, not bugs)
- **Scoring is forgiving** (sparse ~3-edge family overfits its VP fit). Monotonic, good for "a number to optimize." Upgrade: joint VP fit + closed-cube constraint.
- **Reconstruction guard is loose** (0.5 × median edge length). On very messy drawings, C may silently degrade to B instead of failing. Safe but sometimes uninformative.
- **Trace yaw capped to ~17–72°** to avoid face-on/edge-on degenerates. Can widen if user wants extreme angles.

## Blocking on
User's iPad test of the latest build. After that, iterate on real signals (what hurts, what helps) rather than speculative refactoring.
