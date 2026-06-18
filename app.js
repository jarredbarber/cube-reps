import { fitLine, groupByVP, scoreCube, reconstructCube } from './geom.js';

const PALETTE = getComputedStyle(document.documentElement);
const INK = PALETTE.getPropertyValue('--ink').trim();
const LINE = PALETTE.getPropertyValue('--line').trim();
const GOOD = [24, 165, 88];   // --good
const BAD = [229, 72, 77];    // --bad
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('paper');
const ctx = canvas.getContext('2d');
let DPR = 1, W = 0, H = 0;

// State -----------------------------------------------------------------------
let active = [];        // strokes being drawn now: [{ pts:[{x,y,p}] }]
let committed = [];     // frozen reps: [{ strokes, score, box }]
let cur = null;         // in-progress stroke
let fb = null;          // feedback result for the active cube (after Score)

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  draw();
}
window.addEventListener('resize', resize);

// Input — pencil only, high sample rate via coalesced events -------------------
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return; // let touch pan/scroll nothing — but don't draw
  document.getElementById('hint')?.classList.add('gone');
  if (fb) { fb = null; hideReadout(); }  // drawing again starts a fresh judgement
  cur = { pts: [pt(e)] };
  active.push(cur);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!cur) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs) cur.pts.push(pt(ev));
  draw();
});
const endStroke = () => {
  if (!cur) return;
  if (cur.pts.length < 3) active.pop(); // a tap, not an edge
  cur = null; draw();
};
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

const pt = (e) => ({ x: e.offsetX, y: e.offsetY, p: e.pressure || 0.5 });

// Score pipeline --------------------------------------------------------------
function computeFeedback() {
  const lines = active.map((s) => fitLine(s.pts));
  if (lines.length < 6) return null; // not enough edges to define a cube
  const assign = groupByVP(lines);
  const result = scoreCube(lines, assign);
  const overlay = reconstructCube(lines, assign);
  return { lines, assign, ...result, overlay };
}

// Drawing ---------------------------------------------------------------------
let animStart = 0, animProg = 1;
function startAnim() {
  if (REDUCED) { animProg = 1; draw(); return; }
  animStart = performance.now(); animProg = 0;
  requestAnimationFrame(tick);
}
function tick(now) {
  animProg = Math.min(1, (now - animStart) / 650);
  draw();
  if (fb) updateReadout(fb, animProg);
  if (animProg < 1) requestAnimationFrame(tick);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawGrid();
  for (const c of committed) drawStrokes(c.strokes, 'rgba(35,37,40,0.18)', 1, c);
  if (fb) drawFeedback(fb, animProg);
  else drawStrokes(active, INK, null);
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(35,37,40,0.05)'; ctx.lineWidth = 1;
  const g = 40;
  ctx.beginPath();
  for (let x = 0; x <= W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.restore();
}

function drawStrokes(strokes, color, fixedW, committedCube) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    const pts = s.pts;
    for (let i = 1; i < pts.length; i++) {
      ctx.beginPath();
      ctx.lineWidth = fixedW || (1.5 + (pts[i].p || 0.5) * 2.4);
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }
  if (committedCube) {
    ctx.fillStyle = 'rgba(35,37,40,0.35)'; ctx.font = '11px ' + PALETTE.getPropertyValue('--font');
    ctx.fillText(String(committedCube.score), committedCube.box.x, committedCube.box.y - 6);
  }
  ctx.restore();
}

function lerpColor(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function drawFeedback(f, prog) {
  // 1. drawn edges, recolored green->red by their angular error (feature c)
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  f.lines.forEach((l, i) => {
    const t = Math.min(1, f.perEdge[i].errDeg / 15);
    ctx.strokeStyle = lerpColor(GOOD, BAD, t); ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
  });
  ctx.restore();

  // 2. construction rays from each edge toward its vanishing point (signature)
  ctx.save();
  ctx.strokeStyle = 'rgba(30,91,255,0.28)'; ctx.lineWidth = 1; ctx.setLineDash([5, 6]);
  f.lines.forEach((l, i) => {
    const vp = f.vps[f.assign[i]];
    let tx, ty;
    if (vp.atInfinity) { tx = l.cx + vp.dx * 900; ty = l.cy + vp.dy * 900; }
    else { tx = vp.x; ty = vp.y; }
    ctx.beginPath(); ctx.moveTo(l.cx, l.cy);
    ctx.lineTo(l.cx + (tx - l.cx) * prog, l.cy + (ty - l.cy) * prog);
    ctx.stroke();
  });
  ctx.restore();

  // 3. vanishing-point crosshairs (only when on/near screen)
  ctx.save();
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.4;
  for (const vp of f.vps) {
    if (vp.atInfinity) continue;
    if (vp.x < -200 || vp.x > W + 200 || vp.y < -200 || vp.y > H + 200) continue;
    const r = 9 * prog;
    ctx.beginPath();
    ctx.moveTo(vp.x - r, vp.y); ctx.lineTo(vp.x + r, vp.y);
    ctx.moveTo(vp.x, vp.y - r); ctx.lineTo(vp.x, vp.y + r);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(vp.x, vp.y, r * 0.7, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();

  // 4. ideal-cube overlay: C (reconstructed) or B fallback (snapped corners)
  ctx.save();
  ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.globalAlpha = 0.85 * prog;
  if (f.overlay.ok) {
    for (const e of f.overlay.edges) {
      const a = f.overlay.pts[e.a], b = f.overlay.pts[e.b];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  } else {
    drawSnapped(f.overlay.corners, f.lines);
  }
  ctx.restore();
}

// Option B fallback: redraw each edge straight between its nearest snapped corners.
function drawSnapped(corners, lines) {
  if (!corners) return;
  const nearest = (x, y) => corners.reduce((best, c) =>
    Math.hypot(c.x - x, c.y - y) < Math.hypot(best.x - x, best.y - y) ? c : best, corners[0]);
  ctx.setLineDash([]);
  for (const l of lines) {
    const a = nearest(l.x1, l.y1), b = nearest(l.x2, l.y2);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

// Readout ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function updateReadout(f, prog) {
  $('readout').hidden = false;
  $('scoreNum').textContent = Math.round(f.score * prog);
  $('convNum').textContent = Math.round(f.convergence);
  $('straightNum').textContent = Math.round(f.straightness);
  const finite = f.vps.filter((v) => !v.atInfinity).length;
  $('ppNum').textContent = finite + 'pt';
}
function hideReadout() { $('readout').hidden = true; }

// Controls --------------------------------------------------------------------
function boxOf(strokes) {
  let minX = Infinity, minY = Infinity;
  for (const s of strokes) for (const p of s.pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
  return { x: minX, y: minY };
}

$('score').onclick = () => {
  const f = computeFeedback();
  if (!f) { flashHint('Draw at least 6 edges first.'); return; }
  fb = f; startAnim();
};
$('wipe').onclick = () => { active = []; fb = null; hideReadout(); draw(); };
$('keep').onclick = () => {
  if (!active.length) return;
  const score = fb ? fb.score : (computeFeedback()?.score ?? 0);
  committed.push({ strokes: active, score, box: boxOf(active) });
  active = []; fb = null; hideReadout(); draw();
};
$('undo').onclick = () => {
  if (!committed.length) return;
  const last = committed.pop();
  active = last.strokes; fb = null; hideReadout(); draw();
};
$('clear').onclick = () => { committed = []; active = []; fb = null; hideReadout(); draw(); };

function flashHint(msg) {
  const h = $('hint'); h.textContent = msg; h.classList.remove('gone');
  setTimeout(() => h.classList.add('gone'), 1800);
}

resize();
