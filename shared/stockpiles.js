// Zoom-dependent aggregation of ground piles and stores for renderers (browser and server). Pure, no rounding of
// quantities: every cluster carries the exact per-item totals and the member ids/coordinates, so a selection can
// always be resolved to exact stocks. Clusters are keyed by `cell`-sized squares in world tiles.
export const STOCKPILE_VERSION = 1;
// Suggested cell per zoom level (tiles); renderer decides the zoom thresholds.
export const AGGREGATION_CELLS = Object.freeze([1, 2, 4, 8]);
export function aggregatePiles(piles, cell = 4) {
  cell = Math.max(1, Math.floor(cell));
  const by = new Map();
  for (const p of piles ?? []) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    let g = by.get(k);
    if (!g) by.set(k, g = { key: k, cell, x: 0, y: 0, units: 0, items: {}, members: [] });
    let u = 0; for (const [it, n] of Object.entries(p.items ?? {})) { if (!(n > 0)) continue; g.items[it] = (g.items[it] ?? 0) + n; u += n; }
    if (!u) continue;
    g.x += p.x * u; g.y += p.y * u; g.units += u; g.members.push({ id: p.id ?? p.shelter ?? null, x: p.x, y: p.y, units: u });
  }
  const out = [];
  for (const g of by.values()) if (g.units) { g.x = Math.round(g.x / g.units * 10) / 10; g.y = Math.round(g.y / g.units * 10) / 10; out.push(g); }
  return out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
// Visual size class from an exact quantity (so 40 logs and 1 log are not the same sprite). Quantity stays exact.
export function pileSizeClass(units) { return units <= 0 ? 0 : units <= 2 ? 1 : units <= 6 ? 2 : units <= 15 ? 3 : 4; }
