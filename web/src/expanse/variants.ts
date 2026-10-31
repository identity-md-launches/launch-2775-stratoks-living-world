// Original procedural structure/vegetation variants, painted once into 320×320
// cells that share the atlas registration (foot anchor 160,280, light from the
// upper left). Selection is keyed by the stable simulation ID only: no position,
// function, quantity or state is invented, moved or hidden.
import type { Art } from "./art";
import { drawSprite } from "./art";
type Ctx = CanvasRenderingContext2D;
export type Region = "forest" | "desert" | "cold" | "coast";
export const VARIANTS = 4; // variant 0 is the supplied atlas illustration
export function stableHash(id: string | number) {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 1274126177); return (h ^ (h >>> 16)) >>> 0;
}
export function pickVariant(id: string | number) {
  const h = stableHash(id);
  return { index: h % VARIANTS, mirror: ((h >>> 4) & 1) === 1, scale: 0.9 + ((h >>> 8) % 23) / 100 };
}
const rng = (seed: number) => () => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
function poly(g: Ctx, pts: number[][], fill: string, stroke = "#3b2a1c", lw = 2.2) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath();
  g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = "round"; g.stroke(); }
}
function ground(g: Ctx, r: Region, w: number) {
  const c = { forest: "#6f8f45", desert: "#cfae72", cold: "#e6ece8", coast: "#c9b27c" }[r];
  g.fillStyle = shade(c, -0.25); g.beginPath(); g.ellipse(160, 282, w + 6, (w + 6) / 2.2, 0, 0, 7); g.fill();
  g.fillStyle = c; g.beginPath(); g.ellipse(158, 278, w, w / 2.2, 0, 0, 7); g.fill();
}
// Strokes of material texture across a quad (planks, adobe, reed, stone courses).
function texture(g: Ctx, quad: number[][], kind: "plank" | "stone" | "reed" | "adobe", tone: string, rand: () => number) {
  g.save(); g.beginPath(); g.moveTo(quad[0][0], quad[0][1]); for (const p of quad.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.clip();
  const [a, b, , d] = quad, lerp = (p: number[], q: number[], t: number) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  g.strokeStyle = tone; g.lineWidth = kind === "reed" ? 1.4 : 1.8;
  if (kind === "plank" || kind === "reed") for (let t = 0.12; t < 1; t += kind === "reed" ? 0.07 : 0.16) {
    const p = lerp(a, b, t), q = lerp(d, quad[2], t); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
  }
  if (kind === "stone") for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
    const t = (col + (row % 2) * 0.5 + rand() * 0.2) / 5, u = (row + 0.5) / 5;
    const p = lerp(lerp(a, d, u), lerp(b, quad[2], u), t);
    g.fillStyle = rand() > 0.5 ? shade(tone, 0.45) : shade(tone, 0.2); g.beginPath(); g.ellipse(p[0], p[1], 7 + rand() * 4, 4.5 + rand() * 2, 0, 0, 7); g.fill(); g.stroke();
  }
  if (kind === "adobe") for (let n = 0; n < 14; n++) {
    const p = lerp(lerp(a, d, rand()), lerp(b, quad[2], rand()), rand());
    g.fillStyle = tone; g.beginPath(); g.ellipse(p[0], p[1], 3 + rand() * 5, 1.5 + rand() * 2, 0, 0, 7); g.fill();
  }
  g.restore();
}
// Isometric box walls on a footprint of half-width w (x-axis) and depth k (y-axis).
function walls(g: Ctx, cx: number, cy: number, w: number, k: number, h: number, base: string, kind: "plank" | "stone" | "reed" | "adobe", rand: () => number) {
  // Footprint corners: left (W), front (S), right (E); world x → (1,½), y → (−1,½).
  const W = [cx - w - k, cy + (k - w) / 2], S = [cx + w - k, cy + (w + k) / 2], E = [cx + w + k, cy + (w - k) / 2];
  const left = [W, S, [S[0], S[1] - h], [W[0], W[1] - h]], right = [S, E, [E[0], E[1] - h], [S[0], S[1] - h]];
  poly(g, left, shade(base, 0.08)); texture(g, left, kind, shade(base, -0.28), rand); poly(g, left, "transparent");
  poly(g, right, shade(base, -0.22)); texture(g, right, kind, shade(base, -0.45), rand); poly(g, right, "transparent");
  return { W, S, E, h };
}
function door(g: Ctx, a: number[], b: number[], h: number, t = 0.5, color = "#3a2618") {
  const p = [a[0] + (b[0] - a[0]) * (t - 0.12), a[1] + (b[1] - a[1]) * (t - 0.12)], q = [a[0] + (b[0] - a[0]) * (t + 0.12), a[1] + (b[1] - a[1]) * (t + 0.12)];
  poly(g, [p, q, [q[0], q[1] - h], [p[0], p[1] - h]], color, "#24170e", 1.6);
}
function windowLit(g: Ctx, a: number[], b: number[], h0: number, t: number) {
  const p = [a[0] + (b[0] - a[0]) * (t - 0.08), a[1] + (b[1] - a[1]) * (t - 0.08)], q = [a[0] + (b[0] - a[0]) * (t + 0.08), a[1] + (b[1] - a[1]) * (t + 0.08)];
  poly(g, [[p[0], p[1] - h0], [q[0], q[1] - h0], [q[0], q[1] - h0 - 16], [p[0], p[1] - h0 - 16]], "#f2b552", "#3a2618", 1.6);
}
function gableRoof(g: Ctx, b: { W: number[]; S: number[]; E: number[]; h: number }, rise: number, over: number, color: string, kind: "plank" | "reed" | "stone", snow: boolean, rand: () => number) {
  // Ridge parallel to the left wall; overhang `over` px.
  const back = [b.W[0] + (b.E[0] - b.S[0]), b.W[1] + (b.E[1] - b.S[1])];
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const r1 = mid(b.W, back), r2 = mid(b.S, b.E);
  const top1 = [r1[0], r1[1] - b.h - rise], top2 = [r2[0], r2[1] - b.h - rise];
  const eL = [b.W[0] - over, b.W[1] - b.h + over * 0.3], eS = [b.S[0] - over * 0.2, b.S[1] - b.h + over * 0.6];
  const gable = [[b.S[0], b.S[1] - b.h], [b.E[0], b.E[1] - b.h], top2];
  poly(g, gable, "#b38a5a"); texture(g, [gable[0], gable[1], gable[2], gable[2]], "plank", "#7d5a39", rand); poly(g, gable, "transparent");
  const slope = [eL, eS, [top2[0] - over * 0.4, top2[1] + over * 0.1], [top1[0] - over, top1[1]]];
  poly(g, slope, color); texture(g, slope, kind, shade(color, -0.3), rand); poly(g, slope, "transparent");
  if (snow) {
    poly(g, [slope[3], slope[2], [slope[2][0] - 10, slope[2][1] + 12], [slope[3][0] - 12, slope[3][1] + 14]], "#f4f8f6", "#9fb1b4", 1.4);
    for (let n = 0; n < 5; n++) { g.fillStyle = "#f4f8f6"; g.beginPath(); g.ellipse(eL[0] + (eS[0] - eL[0]) * (n + .5) / 5, eL[1] + (eS[1] - eL[1]) * (n + .5) / 5 - 3, 7, 4, 0, 0, 7); g.fill(); }
  }
  g.strokeStyle = "#2c1e13"; g.lineWidth = 3; g.beginPath(); g.moveTo(top1[0] - over, top1[1]); g.lineTo(top2[0], top2[1]); g.stroke();
  return { top1, top2 };
}
function coneRoof(g: Ctx, cx: number, cy: number, rx: number, apex: number, color: string, snow: boolean, rand: () => number) {
  g.beginPath(); g.moveTo(cx - rx, cy); g.quadraticCurveTo(cx - rx * 0.4, cy - apex * 0.55, cx, cy - apex); g.quadraticCurveTo(cx + rx * 0.4, cy - apex * 0.55, cx + rx, cy);
  g.ellipse(cx, cy, rx, rx * 0.36, 0, 0, Math.PI); g.closePath();
  const grad = g.createLinearGradient(cx - rx, 0, cx + rx, 0); grad.addColorStop(0, shade(color, 0.22)); grad.addColorStop(0.55, color); grad.addColorStop(1, shade(color, -0.35));
  g.fillStyle = grad; g.fill(); g.strokeStyle = "#3b2a1c"; g.lineWidth = 2.2; g.stroke();
  g.save(); g.clip(); g.strokeStyle = shade(color, -0.32); g.lineWidth = 1.3;
  for (let n = 0; n < 26; n++) { const t = n / 25 - 0.5 + rand() * 0.02; g.beginPath(); g.moveTo(cx + t * rx * 0.25, cy - apex + 6); g.lineTo(cx + t * rx * 2.1, cy + rx * 0.3 * Math.cos(t * Math.PI)); g.stroke(); }
  if (snow) { g.fillStyle = "#f3f7f5"; g.beginPath(); g.moveTo(cx, cy - apex - 2); g.quadraticCurveTo(cx - rx * 0.55, cy - apex * 0.45, cx - rx * 0.62, cy - apex * 0.28); g.quadraticCurveTo(cx, cy - apex * 0.38, cx + rx * 0.5, cy - apex * 0.3); g.closePath(); g.fill(); }
  g.restore();
}
function dome(g: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, cap?: string) {
  const grad = g.createRadialGradient(cx - rx * 0.4, cy - ry * 0.8, rx * 0.1, cx, cy - ry * 0.3, rx * 1.2);
  grad.addColorStop(0, shade(color, 0.25)); grad.addColorStop(0.6, color); grad.addColorStop(1, shade(color, -0.35));
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, Math.PI, 0); g.ellipse(cx, cy, rx, rx * 0.36, 0, 0, Math.PI); g.closePath();
  g.fillStyle = grad; g.fill(); g.strokeStyle = "#3b2a1c"; g.lineWidth = 2.2; g.stroke();
  if (cap) { g.save(); g.clip(); g.fillStyle = cap; g.beginPath(); g.ellipse(cx - rx * 0.1, cy - ry * 0.95, rx * 0.8, ry * 0.42, -0.1, 0, 7); g.fill(); g.restore(); }
}
function smoke(g: Ctx, x: number, y: number) {
  g.fillStyle = "#e9e3d455"; for (let n = 0; n < 3; n++) { g.beginPath(); g.ellipse(x + n * 5, y - n * 13, 6 + n * 2, 5 + n * 2, 0, 0, 7); g.fill(); }
}
function paintShelter(g: Ctx, region: Region, index: number) {
  const rand = rng(index * 977 + region.length * 131);
  const roofs = { forest: ["#6a7d3e", "#8a5a36", "#a98a4c"], desert: ["#c49a5c", "#b87d4b", "#a98a4c"], cold: ["#6c5a4a", "#7c7f78", "#5d4a3b"], coast: ["#b49b5f", "#9c8452", "#8d7b5b"] }[region];
  const wall = { forest: "#9a7048", desert: "#d1a870", cold: "#8f8c84", coast: "#a2805a" }[region];
  const snow = region === "cold";
  ground(g, region, 92);
  if (index === 1) { // gabled box
    if (region === "coast") { g.strokeStyle = "#4e3826"; g.lineWidth = 7; for (const [x, y] of [[96, 272], [160, 290], [222, 262]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 34); g.stroke(); } }
    const lift = region === "coast" ? 30 : 0;
    const b = walls(g, 160, 236 - lift, 56, 38, region === "desert" ? 66 : 58, wall, region === "cold" ? "stone" : region === "desert" ? "adobe" : "plank", rand);
    door(g, b.S, b.E, 40, 0.45); windowLit(g, b.W, b.S, 20, 0.5);
    const roof = gableRoof(g, b, region === "cold" ? 62 : 46, 12, roofs[0], region === "coast" ? "reed" : "plank", snow, rand);
    if (region !== "coast") { // chimney seated on the far slope, below the ridge
      const cx = roof.top2[0] + (roof.top1[0] - roof.top2[0]) * 0.35 + 6, cy = roof.top2[1] + (roof.top1[1] - roof.top2[1]) * 0.35 + 8;
      poly(g, [[cx - 7, cy + 4], [cx + 7, cy + 4], [cx + 7, cy - 24], [cx - 7, cy - 24]], "#77706a"); poly(g, [[cx - 7, cy + 4], [cx - 2, cy + 6], [cx - 2, cy - 22], [cx - 7, cy - 24]], "#8d857c", "", 0); smoke(g, cx, cy - 34);
    }
  } else if (index === 2) { // round wall + cone / dome
    const cx = 160, cy = 258;
    if (region === "desert") { dome(g, cx, cy, 78, 86, wall); door(g, [cx - 30, cy + 20], [cx + 18, cy + 26], 42, 0.5); poly(g, [[cx - 4, cy - 82], [cx + 8, cy - 86], [cx + 8, cy - 104], [cx - 4, cy - 100]], shade(wall, -0.2)); }
    else if (region === "cold") { dome(g, cx, cy, 82, 74, "#6d7350", "#f3f7f5"); door(g, [cx - 26, cy + 22], [cx + 16, cy + 27], 38, 0.5, "#2b2219"); smoke(g, cx + 20, cy - 86); }
    else {
      g.beginPath(); g.ellipse(cx, cy, 66, 26, 0, 0, Math.PI); g.lineTo(cx - 66, cy - 46); g.ellipse(cx, cy - 46, 66, 26, 0, Math.PI, 0, true); g.closePath();
      const grad = g.createLinearGradient(cx - 66, 0, cx + 66, 0); grad.addColorStop(0, shade(wall, 0.15)); grad.addColorStop(1, shade(wall, -0.35)); g.fillStyle = grad; g.fill(); g.strokeStyle = "#3b2a1c"; g.lineWidth = 2.2; g.stroke();
      g.save(); g.clip(); g.strokeStyle = shade(wall, -0.4); g.lineWidth = 1.5; for (let y = cy - 40; y < cy + 26; y += 9) { g.beginPath(); g.ellipse(cx, y, 66, 26, 0, 0.1, Math.PI - 0.1); g.stroke(); } g.restore();
      door(g, [cx - 30, cy + 22], [cx + 20, cy + 24], 38, 0.5);
      coneRoof(g, cx, cy - 44, 88, 92, roofs[1], false, rand);
    }
  } else { // long hall with lean-to / flat roof with awning
    const b = walls(g, 160, 238, 64, 30, region === "desert" ? 54 : 48, wall, region === "cold" ? "plank" : region === "desert" ? "adobe" : region === "coast" ? "reed" : "plank", rand);
    door(g, b.S, b.E, 36, 0.5); windowLit(g, b.W, b.S, 18, 0.3); windowLit(g, b.W, b.S, 18, 0.72);
    if (region === "desert") {
      const top = [b.W, b.S, b.E, [b.W[0] + b.E[0] - b.S[0], b.W[1] + b.E[1] - b.S[1]]].map(p => [p[0], p[1] - b.h]);
      poly(g, top, shade(wall, 0.18)); poly(g, [[top[0][0] - 6, top[0][1]], [top[1][0], top[1][1] + 4], [top[1][0], top[1][1] - 8], [top[0][0] - 6, top[0][1] - 10]], shade(wall, 0.05));
      const aw = [[b.S[0] + 8, b.S[1] - 34], [b.E[0] - 4, b.E[1] - 34], [b.E[0] + 20, b.E[1] - 14], [b.S[0] + 30, b.S[1] - 12]];
      poly(g, aw, roofs[2]); texture(g, aw, "reed", shade(roofs[2], -0.3), rand); poly(g, aw, "transparent");
      g.strokeStyle = "#5a3f28"; g.lineWidth = 4; for (const p of [aw[2], aw[3]]) { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] + 34); g.stroke(); }
    } else gableRoof(g, b, region === "cold" ? 50 : 34, 14, roofs[2], region === "forest" ? "plank" : "reed", snow, rand);
    if (region === "cold" || region === "forest") { const x = b.W[0] + 4, y = b.W[1]; poly(g, [[x - 26, y + 6], [x, y + 18], [x, y - 22], [x - 26, y - 30]], "#7a5636"); for (let n = 0; n < 4; n++) { g.fillStyle = "#a07447"; g.beginPath(); g.ellipse(x - 13, y - 18 + n * 9, 11, 4, 0.4, 0, 7); g.fill(); g.strokeStyle = "#3b2a1c"; g.lineWidth = 1.2; g.stroke(); } }
  }
}
function foliage(g: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, rand: () => number, snow = false) {
  g.fillStyle = shade(base, -0.3);
  for (let n = 0; n < 9; n++) { const a = n / 9 * Math.PI * 2; g.beginPath(); g.ellipse(cx + Math.cos(a) * rx * 0.55, cy + Math.sin(a) * ry * 0.5, rx * 0.55, ry * 0.55, 0, 0, 7); g.fill(); }
  for (let n = 0; n < 70; n++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()), x = cx + Math.cos(a) * rx * d * 0.95, y = cy + Math.sin(a) * ry * d * 0.95;
    const light = (cx - x) / rx + (cy - y) / ry; // upper-left light
    g.fillStyle = shade(base, Math.max(-0.35, Math.min(0.35, light * 0.22 + (rand() - 0.5) * 0.12)));
    g.beginPath(); g.ellipse(x, y, rx * 0.16, ry * 0.13, rand(), 0, 7); g.fill();
  }
  if (snow) for (let n = 0; n < 16; n++) { const x = cx + (rand() - 0.6) * rx * 1.4, y = cy - ry * 0.3 + (rand() - 0.7) * ry; g.fillStyle = "#f2f6f4"; g.beginPath(); g.ellipse(x, y, rx * 0.15, ry * 0.07, -0.2, 0, 7); g.fill(); }
}
function trunk(g: Ctx, x: number, y: number, top: number, w: number, lean: number, color: string) {
  poly(g, [[x - w, y], [x + w, y], [x + lean + w * 0.45, top], [x + lean - w * 0.45, top]], color, "#2d1f14", 1.8);
  g.strokeStyle = shade(color, -0.35); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + w * 0.3, y - 4); g.lineTo(x + lean + w * 0.15, top + 6); g.stroke();
}
function cone(g: Ctx, x: number, base: number, w: number, h: number, color: string, tiers: number, rand: () => number, snow: boolean) {
  for (let t = 0; t < tiers; t++) {
    const y = base - t * h / tiers * 0.82, ww = w * (1 - t / tiers * 0.72), hh = h / tiers * 1.25;
    g.beginPath(); g.moveTo(x - ww, y); for (let k = 0; k <= 6; k++) g.lineTo(x - ww + (2 * ww) * k / 6, y + (k % 2 ? 6 : 0) - 2 * rand());
    g.lineTo(x, y - hh); g.closePath();
    const grad = g.createLinearGradient(x - ww, 0, x + ww, 0); grad.addColorStop(0, shade(color, 0.18)); grad.addColorStop(1, shade(color, -0.38));
    g.fillStyle = grad; g.fill(); g.strokeStyle = "#1f2e1f"; g.lineWidth = 1.6; g.stroke();
    if (snow) { g.fillStyle = "#f2f6f4"; g.beginPath(); g.moveTo(x - ww * 0.85, y - 2); g.quadraticCurveTo(x - ww * 0.3, y - hh * 0.35, x, y - hh + 4); g.quadraticCurveTo(x - ww * 0.1, y - hh * 0.3, x + ww * 0.4, y - 1); g.closePath(); g.fill(); }
  }
}
function paintTree(g: Ctx, region: Region, index: number) {
  const rand = rng(index * 7919 + region.charCodeAt(1) * 31);
  ground(g, region, 42);
  if (region === "forest") {
    if (index === 1) { trunk(g, 160, 278, 160, 11, -4, "#6b4a2e"); foliage(g, 148, 132, 62, 54, "#4f7a33", rand); foliage(g, 186, 158, 40, 34, "#5d8a3a", rand); }
    else if (index === 2) { trunk(g, 160, 278, 120, 7, 6, "#e7e1d3"); for (let n = 0; n < 5; n++) { g.fillStyle = "#3a332b"; g.fillRect(156 + rand() * 6, 260 - n * 28, 6, 2.5); } foliage(g, 168, 116, 40, 58, "#9aae4a", rand); }
    else { trunk(g, 160, 278, 230, 9, 0, "#5c3f27"); cone(g, 160, 244, 52, 190, "#2f5a36", 4, rand, false); }
  } else if (region === "desert") {
    if (index === 1) { trunk(g, 160, 278, 170, 8, 12, "#7a5636"); g.strokeStyle = "#6a4a2e"; g.lineWidth = 6; g.beginPath(); g.moveTo(170, 190); g.lineTo(128, 150); g.moveTo(172, 182); g.lineTo(214, 146); g.stroke(); foliage(g, 168, 138, 92, 26, "#7f8e3d", rand); }
    else if (index === 2) {
      for (const [lean, top] of [[-26, 116], [22, 140]]) { trunk(g, 160 + lean * 0.2, 278, top, 8, lean, "#8a6a44"); for (let n = 0; n < 7; n++) { const a = -Math.PI * 0.95 + n / 6 * Math.PI * 0.9; g.strokeStyle = n % 2 ? "#5f7d31" : "#79973c"; g.lineWidth = 7; g.lineCap = "round"; g.beginPath(); g.moveTo(160 + lean, top); g.quadraticCurveTo(160 + lean + Math.cos(a) * 34, top + Math.sin(a) * 34 - 10, 160 + lean + Math.cos(a) * 58, top + Math.sin(a) * 20 + 22); g.stroke(); } g.lineCap = "butt"; }
    } else { trunk(g, 160, 278, 196, 10, -8, "#76614a"); foliage(g, 150, 168, 56, 38, "#8c9a6a", rand); }
  } else if (region === "cold") {
    if (index === 1) { trunk(g, 160, 278, 240, 7, 0, "#4f3a2a"); cone(g, 160, 250, 34, 210, "#2d4a3c", 5, rand, true); }
    else if (index === 2) { trunk(g, 160, 278, 120, 7, 4, "#5a4636"); g.strokeStyle = "#5a4636"; g.lineWidth = 3; for (let n = 0; n < 9; n++) { const y = 250 - n * 15, d = 44 - n * 4; g.beginPath(); g.moveTo(162, y); g.lineTo(162 + (n % 2 ? d : -d), y - 14); g.stroke(); g.fillStyle = "#eef3f1"; g.beginPath(); g.ellipse(162 + (n % 2 ? d : -d) * 0.6, y - 10, 8, 3, 0, 0, 7); g.fill(); } }
    else { trunk(g, 160, 278, 180, 9, -2, "#4f3a2a"); foliage(g, 158, 150, 56, 50, "#355543", rand, true); }
  } else {
    if (index === 1) { trunk(g, 160, 278, 150, 9, 34, "#5e4430"); foliage(g, 210, 128, 66, 30, "#3f6a3c", rand); foliage(g, 170, 150, 34, 22, "#4b7a40", rand); }
    else if (index === 2) { trunk(g, 160, 278, 222, 7, 0, "#5e4430"); foliage(g, 160, 150, 26, 92, "#355c3a", rand); }
    else { trunk(g, 160, 278, 214, 9, -6, "#6a4b30"); foliage(g, 154, 190, 54, 44, "#5c8443", rand); }
  }
}
const cache = new Map<string, HTMLCanvasElement>();
function cell(key: string, paint: (g: Ctx) => void) {
  let c = cache.get(key);
  if (!c) { c = document.createElement("canvas"); c.width = c.height = 320; paint(c.getContext("2d")!); cache.set(key, c); }
  return c;
}
/** Draws a variant of the supplied atlas sprite; same anchor/width contract as drawSprite. */
export function drawVariant(g: Ctx, art: Art, family: "shelter" | "tree", region: Region, id: string | number, atlasName: string, x: number, y: number, width: number, alpha = 1) {
  const v = pickVariant(id), w = width * (family === "tree" ? v.scale : 1);
  g.save();
  if (v.mirror) { g.translate(x * 2, 0); g.scale(-1, 1); }
  if (v.index === 0) drawSprite(g, art, atlasName, x, y, w, alpha);
  else {
    const c = cell(`${family}:${region}:${v.index}`, (p) => (family === "shelter" ? paintShelter : paintTree)(p, region, v.index)), ratio = w / 320;
    g.globalAlpha = alpha; g.drawImage(c, x - 160 * ratio, y - 280 * ratio, 320 * ratio, 320 * ratio); g.globalAlpha = 1;
  }
  g.restore();
}
