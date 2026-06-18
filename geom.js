// Pure geometry for cube-reps. No DOM — runnable in Node for self-checks.
// Pipeline: strokes -> fitLine each -> groupByAngle(k=3) -> fitVP per family
//           -> edgeError per edge -> scoreCube.

// Fit a straight line to a stroke's points via PCA (total least squares).
// Returns centroid, unit direction, length along that direction, and
// `wobble` = RMS perpendicular distance of points from the fit line (px).
export function fitLine(points) {
  const n = points.length;
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  sxx /= n; sxy /= n; syy /= n;

  // Principal axis angle of the 2x2 covariance (largest eigenvalue direction).
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta), dy = Math.sin(theta);

  // Project points onto the axis (length) and perpendicular (wobble).
  let tMin = Infinity, tMax = -Infinity, perpSq = 0;
  for (const p of points) {
    const vx = p.x - cx, vy = p.y - cy;
    const t = vx * dx + vy * dy;
    const perp = vx * -dy + vy * dx;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    perpSq += perp * perp;
  }
  const length = tMax - tMin;
  const wobble = Math.sqrt(perpSq / n);

  // Endpoints of the fit segment, for drawing the corrected edge.
  return {
    cx, cy, dx, dy, length, wobble,
    x1: cx + dx * tMin, y1: cy + dy * tMin,
    x2: cx + dx * tMax, y2: cy + dy * tMax,
  };
}

// Mean of undirected angles (period PI): double-angle vector average.
function meanAngle(angles) {
  let s = 0, c = 0;
  for (const a of angles) { s += Math.sin(2 * a); c += Math.cos(2 * a); }
  return 0.5 * Math.atan2(s, c);
}

// Small seeded PRNG (mulberry32) so grouping is deterministic for tests.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// VP for a cluster, degrading gracefully for tiny clusters.
function vpOf(grp) {
  if (grp.length >= 2) return fitVanishingPoint(grp);
  if (grp.length === 1) return { atInfinity: true, dx: grp[0].dx, dy: grp[0].dy };
  return { atInfinity: true, dx: 1, dy: 0 };
}

// Recover the cube's 3 edge families by clustering in VANISHING-POINT space:
// assign each edge to the VP it best aims at, refit VPs, repeat (k-means with
// an angular-error distance). Angle clustering fails here because two cube
// families are both near-horizontal; agreement on a VP separates them.
// Random restarts (seeded) escape local minima. Returns assignment 0..k-1.
export function groupByVP(lines, k = 3, restarts = 20) {
  if (lines.length <= k) return lines.map((_, i) => i % k);
  const rand = rng(0x5eed);
  let best = null, bestCost = Infinity;

  for (let r = 0; r < restarts; r++) {
    let assign = lines.map(() => Math.floor(rand() * k));
    for (let c = 0; c < k; c++) {            // guarantee no empty start cluster
      if (!assign.includes(c)) assign[Math.floor(rand() * lines.length)] = c;
    }
    let prev = null;
    for (let iter = 0; iter < 25; iter++) {
      const vps = [];
      for (let c = 0; c < k; c++) vps.push(vpOf(lines.filter((_, i) => assign[i] === c)));
      const next = lines.map((l) => {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const d = edgeError(l, vps[c]); if (d < bd) { bd = d; bi = c; } }
        return bi;
      });
      if (prev && next.every((v, i) => v === prev[i])) { assign = next; break; }
      prev = next; assign = next;
    }
    const vps = [];
    for (let c = 0; c < k; c++) vps.push(vpOf(lines.filter((_, i) => assign[i] === c)));
    const cost = lines.reduce((s, l, i) => s + edgeError(l, vps[assign[i]]), 0);
    if (cost < bestCost) { bestCost = cost; best = assign.slice(); }
  }
  return best;
}

// Least-squares vanishing point of a family of lines.
// Each line: n·(p - c) = 0 with unit normal n = (-dy, dx), so a*x+b*y+c0=0.
// Minimize sum (a x + b y + c0)^2  -> 2x2 normal equations.
// Near-parallel families -> singular -> VP at infinity (2-point perspective).
export function fitVanishingPoint(lines) {
  let Saa = 0, Sab = 0, Sbb = 0, Sac = 0, Sbc = 0;
  for (const l of lines) {
    const a = -l.dy, b = l.dx;
    const c0 = -(a * l.cx + b * l.cy);
    Saa += a * a; Sab += a * b; Sbb += b * b;
    Sac += a * c0; Sbc += b * c0;
  }
  const det = Saa * Sbb - Sab * Sab;
  const trace = Saa + Sbb;
  // Relative conditioning: tiny det vs trace^2 means the lines are parallel.
  if (Math.abs(det) < 1e-9 * (trace * trace + 1e-9)) {
    const a = meanAngle(lines.map((l) => Math.atan2(l.dy, l.dx)));
    return { atInfinity: true, dx: Math.cos(a), dy: Math.sin(a) };
  }
  const x = (-Sac * Sbb + Sbc * Sab) / det;
  const y = (-Sbc * Saa + Sac * Sab) / det;
  return { atInfinity: false, x, y };
}

// Acute angle (radians, [0, PI/2]) between an edge and the direction it
// "should" point — toward its family's vanishing point.
export function edgeError(line, vp) {
  let ux, uy;
  if (vp.atInfinity) { ux = vp.dx; uy = vp.dy; }
  else { ux = vp.x - line.cx; uy = vp.y - line.cy; }
  const un = Math.hypot(ux, uy) || 1;
  ux /= un; uy /= un;
  const dot = Math.abs(line.dx * ux + line.dy * uy);
  return Math.acos(Math.min(1, dot));
}

// Score a cube. convergence = how well edges aim at their VPs;
// straightness = how little the strokes wobbled. Both 0..100, blended 70/30.
export function scoreCube(lines, assign) {
  const k = Math.max(...assign) + 1;
  const families = [];
  for (let c = 0; c < k; c++) families.push(lines.filter((_, i) => assign[i] === c));
  const vps = families.map(fitVanishingPoint);

  const perEdge = lines.map((l, i) => {
    const vp = vps[assign[i]];
    const errDeg = (edgeError(l, vp) * 180) / Math.PI;
    const wobbleRatio = l.length ? l.wobble / l.length : 1;
    return { errDeg, wobbleRatio };
  });

  const meanErr = perEdge.reduce((s, e) => s + e.errDeg, 0) / perEdge.length;
  const meanWobble = perEdge.reduce((s, e) => s + e.wobbleRatio, 0) / perEdge.length;

  // ponytail: convergence is per-edge error to a VP fit FROM those same edges,
  // so a sparse (~3-edge) family overfits and the score is forgiving/compressed.
  // Upgrade path if it feels too lenient: jointly fit 3 VPs + enforce a closed
  // cube (shared vertices) and score the reconstruction residual.
  const convergence = clamp(100 - meanErr * (100 / 20), 0, 100);   // 20deg err -> 0
  const straightness = clamp(100 - meanWobble * (100 / 0.05), 0, 100); // 5% wobble -> 0
  const score = Math.round(0.7 * convergence + 0.3 * straightness);

  return { score, convergence, straightness, vps, families, perEdge };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---- Overlay reconstruction (Option C, falls back to B) --------------------

// Unit direction from point P toward a vanishing point (or its direction if the
// VP is at infinity / 2-point perspective).
function dirToward(P, vp) {
  let dx, dy;
  if (vp.atInfinity) { dx = vp.dx; dy = vp.dy; }
  else { dx = vp.x - P.x; dy = vp.y - P.y; }
  const n = Math.hypot(dx, dy) || 1;
  return { x: dx / n, y: dy / n };
}

// Intersection of line (p1 along d1) and line (p2 along d2). null if parallel.
function intersect(p1, d1, p2, d2) {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const s = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + s * d1.x, y: p1.y + s * d1.y };
}

function project(P, dir, Q) {
  const t = (Q.x - P.x) * dir.x + (Q.y - P.y) * dir.y;
  return { x: P.x + t * dir.x, y: P.y + t * dir.y };
}

// Greedy-cluster stroke endpoints into shared corners.
function clusterEndpoints(lines, tol) {
  const pts = [];
  lines.forEach((l, i) => {
    pts.push({ x: l.x1, y: l.y1, line: i });
    pts.push({ x: l.x2, y: l.y2, line: i });
  });
  const corners = []; // { x, y, lines:Set }
  for (const p of pts) {
    let hit = null;
    for (const c of corners) if (Math.hypot(c.x - p.x, c.y - p.y) < tol) { hit = c; break; }
    if (!hit) { hit = { x: p.x, y: p.y, n: 0, lines: new Set() }; corners.push(hit); }
    // running mean keeps the corner centered as members join
    hit.x = (hit.x * hit.n + p.x) / (hit.n + 1);
    hit.y = (hit.y * hit.n + p.y) / (hit.n + 1);
    hit.n++; hit.lines.add(p.line);
  }
  return corners;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

// Build the perspectively-exact "ideal" cube. Returns { ok, pts:{000..111},
// edges:[{a,b,family}] }. Falls back to ok:false when topology isn't a clean
// cube — the caller then draws Option B (snapped corners, no correction).
export function reconstructCube(lines, assign) {
  const med = median(lines.map((l) => l.length)) || 100;
  const tol = 0.18 * med; // tight: over-merging corners builds a wrong cube
  const vps = [0, 1, 2].map((f) => fitVanishingPoint(lines.filter((_, i) => assign[i] === f)));
  const corners = clusterEndpoints(lines, tol);

  // For each line, which two corners it joins.
  const lineCorners = lines.map(() => []);
  corners.forEach((c, ci) => c.lines.forEach((li) => lineCorners[li].push(ci)));

  // Per corner: family -> neighbor corner index (via incident lines).
  const famNbr = corners.map(() => ({}));
  lines.forEach((_, li) => {
    const [a, b] = lineCorners[li];
    if (a === undefined || b === undefined || a === b) return;
    const f = assign[li];
    famNbr[a][f] = b; famNbr[b][f] = a;
  });

  // Anchor = a corner with all 3 families incident (the front corner).
  const anchor = famNbr.findIndex((m) => m[0] !== undefined && m[1] !== undefined && m[2] !== undefined);
  if (anchor < 0) return { ok: false, corners };

  const P000 = { x: corners[anchor].x, y: corners[anchor].y };
  const adj = {};
  for (const f of [0, 1, 2]) {
    const nb = corners[famNbr[anchor][f]];
    adj[f] = project(P000, dirToward(P000, vps[f]), { x: nb.x, y: nb.y });
  }
  const P100 = adj[0], P010 = adj[1], P001 = adj[2];

  // Forced corners: each lies on two rays toward the appropriate VPs.
  const P110 = intersect(P100, dirToward(P100, vps[1]), P010, dirToward(P010, vps[0]));
  const P101 = intersect(P100, dirToward(P100, vps[2]), P001, dirToward(P001, vps[0]));
  const P011 = intersect(P010, dirToward(P010, vps[2]), P001, dirToward(P001, vps[1]));
  if (!P110 || !P101 || !P011) return { ok: false, corners };
  const P111 = intersect(P110, dirToward(P110, vps[2]), P101, dirToward(P101, vps[1]));
  if (!P111) return { ok: false, corners };

  const pts = { '000': P000, '100': P100, '010': P010, '001': P001,
                '110': P110, '101': P101, '011': P011, '111': P111 };

  // Guard: if the constructed cube doesn't actually fit the drawn strokes
  // (bad topology, mislabel, over-merge), reject so the caller draws B instead.
  const ideal = Object.values(pts);
  let res = 0, nE = 0;
  for (const l of lines) for (const e of [[l.x1, l.y1], [l.x2, l.y2]]) {
    let dm = Infinity;
    for (const p of ideal) dm = Math.min(dm, Math.hypot(p.x - e[0], p.y - e[1]));
    res += dm; nE++;
  }
  if (res / nE > 0.5 * med) return { ok: false, corners }; // loosened for messy real strokes

  return { ok: true, pts, edges: edgesOf(pts), vps };
}

// 12 cube edges, labeled by the axis (family) they run along.
const CUBE_EDGES = [
  ['000', '100', 0], ['010', '110', 0], ['001', '101', 0], ['011', '111', 0],
  ['000', '010', 1], ['100', '110', 1], ['001', '011', 1], ['101', '111', 1],
  ['000', '001', 2], ['100', '101', 2], ['010', '011', 2], ['110', '111', 2],
];
function edgesOf(pts) { return CUBE_EDGES.map(([a, b, family]) => ({ a, b, family })); }

// Generate a random cube to trace by building a real 3D cube, rotating it by a
// random yaw/pitch (genuine orientation variety), and projecting it. The 3
// vanishing points fall out of the axis directions. Retries until on-canvas.
// Returns { pts, edges, vps }.
export function generateCube(w, h, rand = Math.random) {
  let last = null;
  for (let i = 0; i < 24; i++) {
    const c = projectCube(w, h, rand);
    last = c;
    if (Object.values(c.pts).every((p) => p.x > 10 && p.x < w - 10 && p.y > 10 && p.y < h - 10)) return c;
  }
  return last;
}

function projectCube(w, h, rand) {
  const cx = w / 2, cy = h * 0.5;
  const f = Math.min(w, h) * 1.15;            // focal length (px)
  const dist = 3.0 + rand() * 1.4;            // camera distance (cube units)
  const yaw = (rand() < 0.5 ? 1 : -1) * (0.3 + rand() * 0.95); // ~17-72 deg, either side
  const pitch = (rand() - 0.5) * 0.85;        // look down/up
  const cw = Math.cos(yaw), sw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);

  // Rotate (yaw about vertical Y, then pitch about X), push in front of camera.
  const rot = (x, y, z) => {
    const x1 = x * cw + z * sw, z1 = -x * sw + z * cw;
    return { x: x1, y: y * cp - z1 * sp, z: y * sp + z1 * cp };
  };
  const proj = (p) => ({ x: cx + f * p.x / (p.z + dist), y: cy - f * p.y / (p.z + dist) });

  // Vertex (i,j,k): i=axis0 (x), j=axis1 (depth z), k=axis2 (vertical y).
  const pts = {};
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) {
    pts[`${i}${j}${k}`] = proj(rot(i - 0.5, k - 0.5, j - 0.5));
  }

  // Vanishing point per axis = image of that axis direction at infinity.
  // rot args are (x_horiz, y_vert, z_depth); families 0,1,2 = x, depth, vertical.
  const axisDirs = [[1, 0, 0], [0, 0, 1], [0, 1, 0]];
  const vps = axisDirs.map(([ax, ay, az]) => {
    const d = rot(ax, ay, az);
    if (Math.abs(d.z) < 1e-4) {              // parallel in image -> at infinity
      const n = Math.hypot(d.x, d.y) || 1;
      return { atInfinity: true, dx: d.x / n, dy: -d.y / n };
    }
    return { atInfinity: false, x: cx + f * d.x / d.z, y: cy - f * d.y / d.z };
  });

  return { pts, edges: edgesOf(pts), vps };
}
