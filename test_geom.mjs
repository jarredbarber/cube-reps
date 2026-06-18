// Self-check: a near-perfect cube scores high; a skewed one scores lower.
// Run: node test_geom.mjs
import assert from 'node:assert';
import { fitLine, groupByVP, scoreCube, reconstructCube } from './geom.js';

// Build straight strokes for 3 edge families, each aimed at a vanishing point.
const VPS = [{ x: 2000, y: 300 }, { x: -1500, y: 400 }, { x: 400, y: 6000 }];
const STARTS = [ // 3 edges per family, scattered start points
  [[200, 350], [260, 520], [180, 690]],
  [[700, 360], [760, 540], [690, 700]],
  [[300, 350], [620, 360], [470, 520]],
];

function edgeToward(p0, vp, len, jitter = 0) {
  const dx = vp.x - p0[0], dy = vp.y - p0[1];
  const n = Math.hypot(dx, dy);
  const ux = dx / n, uy = dy / n;
  const pts = [];
  for (let t = 0; t <= len; t += 8) {
    // jitter perpendicular to the line to simulate hand wobble
    const w = jitter ? (Math.sin(t * 0.3) * jitter) : 0;
    pts.push({ x: p0[0] + ux * t - uy * w, y: p0[1] + uy * t + ux * w });
  }
  return pts;
}

// `noiseDeg` rotates EACH edge by an independent random angle, so the family
// no longer shares a vanishing point — that's a genuinely bad cube. (A uniform
// rotation is just a different valid view and should still score high.)
let seed = 1;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function buildCube({ jitter = 0, noiseDeg = 0 }) {
  const lines = [];
  STARTS.forEach((family, f) => {
    family.forEach((p0) => {
      let vp = VPS[f];
      if (noiseDeg) {
        const a = ((rand() * 2 - 1) * noiseDeg * Math.PI) / 180;
        const dx = vp.x - p0[0], dy = vp.y - p0[1];
        vp = { x: p0[0] + dx * Math.cos(a) - dy * Math.sin(a),
               y: p0[1] + dx * Math.sin(a) + dy * Math.cos(a) };
      }
      lines.push(fitLine(edgeToward(p0, vp, 140, jitter)));
    });
  });
  return lines;
}

const perfect = buildCube({});
const sPerfect = scoreCube(perfect, groupByVP(perfect));
assert(sPerfect.score >= 95, `perfect cube should score >=95, got ${sPerfect.score}`);

const skewed = buildCube({ noiseDeg: 30 });
const sSkewed = scoreCube(skewed, groupByVP(skewed));
// Monotonic is all we claim: a noisy cube scores below a clean one. The margin
// is compressed because a sparse (~3-edge) family's VP overfits its own lines.
assert(sSkewed.score < sPerfect.score - 5,
  `noisy cube should score below perfect, got ${sSkewed.score} vs ${sPerfect.score}`);

const wobbly = buildCube({ jitter: 6 });
const sWobbly = scoreCube(wobbly, groupByVP(wobbly));
assert(sWobbly.straightness < sPerfect.straightness - 10,
  `wobbly cube should lose straightness, got ${sWobbly.straightness}`);

// ---- Reconstruction (Option C) round-trip ---------------------------------
// Build a clean axonometric ground-truth cube (3 independent axes, well-spread
// corners), draw its 9 visible edges, confirm reconstructCube recovers them.
const norm = (v) => { const n = Math.hypot(v.x, v.y); return { x: v.x / n, y: v.y / n }; };
const U = [norm({ x: 1, y: 0.42 }), norm({ x: -1, y: 0.42 }), { x: 0, y: -1 }]; // axes 0,1,2
const L = 190;
const G = {};
for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) {
  G[`${i}${j}${k}`] = {
    x: 500 + i * L * U[0].x + j * L * U[1].x + k * L * U[2].x,
    y: 460 + i * L * U[0].y + j * L * U[1].y + k * L * U[2].y,
  };
}

const VIS = [ // 9 visible edges (those not touching the hidden corner 111)
  ['000', '100', 0], ['010', '110', 0], ['001', '101', 0],
  ['000', '010', 1], ['100', '110', 1], ['001', '011', 1],
  ['000', '001', 2], ['100', '101', 2], ['010', '011', 2],
];
const recLines = [], recAssign = [];
for (const [a, b, f] of VIS) {
  const pa = G[a], pb = G[b], pts = [];
  for (let t = 0; t <= 1.0001; t += 0.1) pts.push({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t });
  recLines.push(fitLine(pts)); recAssign.push(f);
}
const rec = reconstructCube(recLines, recAssign);
assert(rec.ok, 'reconstruction should succeed on a clean cube');
for (const k of Object.keys(G)) {
  const g = G[k];
  const ok = Object.values(rec.pts).some((p) => Math.hypot(p.x - g.x, p.y - g.y) < 1);
  assert(ok, `ground-truth corner ${k} not reproduced by overlay`);
}

// Fallback: input that isn't a cube (3 parallel strokes) must degrade, not throw.
const par = [fitLine([{ x: 0, y: 0 }, { x: 100, y: 1 }]),
             fitLine([{ x: 0, y: 60 }, { x: 100, y: 61 }]),
             fitLine([{ x: 0, y: 120 }, { x: 100, y: 121 }])];
assert(reconstructCube(par, [0, 0, 0]).ok === false, 'degenerate input should fall back to B');

console.log(`OK  perfect=${sPerfect.score}  skewed=${sSkewed.score}  wobbly=${sWobbly.score}  overlay=reconstructed`);
