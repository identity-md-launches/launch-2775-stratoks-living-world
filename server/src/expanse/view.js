// Read-only views of the expanse for clients: a bounded viewport, a coarse minimap and a creature inspector.
// These never mutate the world; generating a viewport may materialize pristine chunks deterministically.
import { terrainHeight, RELIEF_VERSION } from '../../../shared/relief.js';
import { NODE_KINDS, settleNode } from './terrain.js';
export const VIEW_VERSION = 1;
// Additive schema-4 fields keep `v: 1` so existing clients keep working; `living` names the extension version.
export const LIVING_VERSION = 2; // 2: ruins, crops, signals, goal/communication evidence in the inspector
import { confidence } from './agency.js';
import { GLYPHS } from './capabilities.js';
import { aggregatePiles, pileSizeClass, STOCKPILE_VERSION } from '../../../shared/stockpiles.js';
import { CHAINS_VERSION } from './chains.js';
const MAX_W = 96, MAX_H = 96;

export function viewport(e, x0, y0, w, h) {
  // The legacy /view route is public too. Reject non-finite coordinates through safe defaults,
  // and bound large finite values before spatial loops (adding 1 to 1e300 never advances a loop).
  const b = e.bounds(), finite = (v, d) => Number.isFinite(v) ? Math.round(v) : d;
  w = Math.min(MAX_W, b.x1 - b.x0, Math.max(1, finite(w, 48)));
  h = Math.min(MAX_H, b.y1 - b.y0, Math.max(1, finite(h, 32)));
  x0 = Math.max(b.x0, Math.min(b.x1 - w, finite(x0, 0)));
  y0 = Math.max(b.y0, Math.min(b.y1 - h, finite(y0, 0)));
  const tiles = new Array(w * h), biomes = new Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { tiles[j * w + i] = e.tile(x0 + i, y0 + j); biomes[j * w + i] = e.biome(x0 + i, y0 + j); }
  const nodes = e.nodesNear(x0 + (w >> 1), y0 + (h >> 1), Math.max(w, h) >> 1, false).filter((n) => n.x >= x0 && n.y >= y0 && n.x < x0 + w && n.y < y0 + h).map((n) => [n.id, n.kind, n.x, n.y, settleNode({ ...n }, e.tick).units]);
  // Tuple elements 0..5 are unchanged; 6 = activity state, 7 = phase, 8 = progress 0..1, 9 = carried load weight.
  const creatures = e.creaturesNear(x0 + (w >> 1), y0 + (h >> 1), Math.max(w, h) >> 1).filter((c) => c.x >= x0 && c.y >= y0 && c.x < x0 + w && c.y < y0 + h).map((c) => { const a = e.activity(c); return [c.id, c.name, c.x, c.y, c.act?.prim ?? null, Math.round(c.health), a.state, a.phase, a.progress, a.load]; });
  const inView = (s) => s.x >= x0 && s.y >= y0 && s.x < x0 + w && s.y < y0 + h;
  return { v: VIEW_VERSION, tick: e.tick, x0, y0, w, h, tiles, heights: tiles.map(terrainHeight), relief: RELIEF_VERSION, biomes, biome: e.biome(x0 + (w >> 1), y0 + (h >> 1)), climate: { temperature: r(e.ambient(x0 + (w >> 1), y0 + (h >> 1))), rain: e.weather.rain, daylight: r(e.daylight()) }, nodes, creatures,
    fires: e.fires.filter((f) => f.x >= x0 && f.y >= y0 && f.x < x0 + w && f.y < y0 + h).map((f) => [f.id, f.x, f.y]),
    fireState: e.fires.filter(inView).map(f => ({ id: f.id, x: f.x, y: f.y, fuel: f.fuel })),
    // Finished shelters only (old clients draw every entry as a home): [id, x, y, kind, integrity, storedUnits].
    // Ruins (integrity 0) are not homes and are listed separately in `ruins`, so old clients do not draw them as homes.
    shelters: e.shelters.filter((s) => inView(s) && s.complete !== false && s.integrity > 0).map((s) => [s.id, s.x, s.y, s.kind ?? null, Math.round(s.integrity), units(s.store)]),
    ruins: e.shelters.filter((s) => inView(s) && s.complete !== false && s.integrity <= 0).map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind ?? null, stored: units(s.store), usable: false })),
    crops: e.crops.filter(inView).map((q) => ({ id: q.id, x: q.x, y: q.y, kind: q.kind, growth: q.growth, ripe: q.ripe, dry: q.moisture <= 0, planter: q.by, moisture: q.moisture, waterReachable: e.naturalWater(q.x, q.y, 4) })),
    // Recent neutral glyphs emitted in view (observer evidence; residents only get what they perceive).
    signals: e.signals.filter((g) => inView(g) && e.tick - g.tick <= 60).map((g) => ({ id: g.id, x: g.x, y: g.y, glyph: g.glyph, from: g.from, tick: g.tick, heardBy: g.receivers.length })),
    // Unfinished construction: actual stage, delivered materials, required materials and labour.
    sites: e.shelters.filter((s) => inView(s) && s.complete === false).map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind, stage: s.stage, materials: { ...s.materials }, need: { ...s.need }, work: s.work, workNeed: s.workNeed })),
    // Ground piles (material stock areas) and shelter stores, with exact contents.
    piles: pilesIn(e, x0, y0, w, h).map((p) => ({ ...p, size: pileSizeClass(Object.values(p.items).reduce((t, n) => t + n, 0)) })),
    // Zoom-out aggregation (4-tile cells) with exact item totals and member ids; see shared/stockpiles.js.
    pileClusters: { v: STOCKPILE_VERSION, cell: 4, clusters: aggregatePiles(pilesIn(e, x0, y0, w, h), 4) },
    stores: e.shelters.filter((s) => inView(s) && s.complete !== false && units(s.store) > 0).map((s) => ({ shelter: s.id, x: s.x, y: s.y, items: { ...s.store }, ...(s.integrity <= 0 ? { ruined: true } : {}) })),
    living: LIVING_VERSION };
}
// Minimap: biome letter per generated chunk only (unvisited chunks are not revealed or generated).
export function minimap(e) { return { v: VIEW_VERSION, ...e.extentChunks(), chunks: [...e.chunks.values()].map((c) => [c.cx, c.cy, c.biome[392][0]]),
  // Keep the legacy letter field for old readers; cold and coast both used "c".
  // New clients use the full representative biome at the chunk centre.
  biomes: [...e.chunks.values()].map((c) => [c.cx, c.cy, c.biome[14 * 28 + 14]]) }; }
export function inspect(e, id) {
  const c = e.getCreature(id); if (!c) return null;
  const m = c.mind;
  return { v: VIEW_VERSION, id: c.id, name: c.name, age: c.age, x: c.x, y: c.y, needs: { hunger: r(c.hunger), thirst: r(c.thirst), energy: r(c.energy), health: r(c.health), warmth: r(c.warmth), injury: c.injury },
    inventory: c.inventory, personality: c.personality, observation: c.lastObs ?? null, activity: e.activity(c), toolWear: c.toolWear ?? {}, home: c.home,
    currentPlan: c.plan ? { id: c.plan.id, tick: c.plan.tick, source: c.plan.source, steps: c.plan.steps, predicted: c.plan.predicted, actual: c.plan.actual, utility: c.plan.utility, mbPreference: c.plan.mbPreference, alternatives: c.plan.alternatives, index: c.plan.idx, plannerVersion: c.plan.plannerVersion } : null,
    recentPlans: m.plans, episodes: m.episodes.slice(-12), knownNodes: Object.keys(m.known).length, knownWater: m.water, discoveries: m.discoveries,
    modelEntries: Object.keys(m.model).length, mbUpdates: c.brain.mb?.updates ?? 0, mode: e.mode, learning: e.learning && e.mode !== 'frozen',
    relationships: c.relationships, reputation: c.reputation, following: c.following,
    // What the resident itself knows about stores: last visit only (null = never visited), with its age.
    knownStores: (m.shelters ?? []).map((s) => ({ id: s.id, x: s.x, y: s.y, stock: s.stock ?? null, visited: s.visited ?? null, staleTicks: s.visited ? e.tick - s.visited : null, ruined: !!s.ruined, integrity: s.integrity ?? null })),
    goals: { active: (m.goals ?? []).map((g) => ({ id: g.id, kind: g.kind, status: g.status, urgency: g.urgency, since: g.since, steps: g.steps, interruptions: g.interruptions, resumed: g.resumed, avoiding: g.avoid })), history: m.goalHistory ?? [], stats: m.goalStats ?? {},
      learned: Object.entries(m.goalModel ?? {}).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k, v]) => ({ goalStep: k, n: v.n, meanProgress: v.gain })) },
    // Decision evidence (actual needs, perception counts, demand, scored alternatives) and connected activity chains.
    decisions: m.decisions ?? [], chains: { v: CHAINS_VERSION, materialsInHand: Object.values(m.prov ?? {}), food: m.food ?? null, search: m.search ?? null, completed: m.chainStats ?? null,
      toolWear: Object.fromEntries(Object.entries(c.toolWear ?? {}).map(([k, n]) => [k, { used: n, uses: e.toolUses(k) }])) },
    communication: { label: 'limited learned signalling: neutral glyphs, associations from local co-occurrence and outcomes; no dictionary',
      heard: m.heard ?? [], sent: m.sent ?? [], trust: c.trust ?? {},
      associations: Object.entries(m.signals ?? {}).map(([g, a]) => ({ glyph: g, heard: a.heard, responded: a.responded, outcomes: a.n, meanPayoff: a.payoff, confidence: confidence(a), cooccurred: a.seen })),
      senderValues: GLYPHS.flatMap((g) => Object.entries(m.model).filter(([k]) => k.startsWith(`signal|${g}|`)).map(([k, v]) => ({ key: k, n: Math.round(v.n * 100) / 100, reward: Math.round(v.r * 1000) / 1000 }))) },
    note: 'Learned: outcome model + mb-v1 weights. Designed: physics, primitives, reflexes, drives, planner search. Not a complete fly brain.' };
}
const r = (v) => Math.round(v * 10) / 10;
const units = (o) => Object.values(o ?? {}).reduce((t, n) => t + n, 0);
function pilesIn(e, x0, y0, w, h) {
  const out = [];
  for (const ch of e.chunks.values()) {
    if ((ch.cx + 1) * 28 <= x0 || ch.cx * 28 >= x0 + w || (ch.cy + 1) * 28 <= y0 || ch.cy * 28 >= y0 + h) continue;
    for (const p of ch.piles) if (p.x >= x0 && p.y >= y0 && p.x < x0 + w && p.y < y0 + h) out.push({ id: p.id, x: p.x, y: p.y, items: { ...p.items } });
  }
  return out;
}
export { NODE_KINDS };
// Real state-derived chain stage for a resident (never a fabricated thought): what it is doing within a chain.
function chainStage(c) {
  const m = c.mind, a = c.act;
  if (m.search) return { kind: 'explore', stage: m.search.found ? 'return' : 'search', item: m.search.item };
  if (a && ['build', 'repair', 'mend'].includes(a.prim)) return { kind: 'materials', stage: 'use', item: a.item ?? null };
  if (a && (a.prim === 'carry' || a.prim === 'deposit' || a.prim === 'retrieve') && !a.help) return { kind: 'materials', stage: a.prim === 'deposit' ? 'store' : 'transport', item: a.item ?? null };
  if (m.food) return { kind: 'food', stage: a?.prim === 'cook' ? 'prepare' : a?.prim === 'share' || a?.help !== undefined ? 'share' : 'hold', item: m.food.item };
  return null;
}

// One synchronous read: the viewport, roster and inspector all describe the same authoritative tick.
// The observer's global roster is never passed back into an agent's decision/perception interfaces.
export function frame(e, { x = 0, y = 0, w = 48, h = 32, creature = null } = {}) {
  const bounds = e.bounds();
  const finite = (v, fallback) => Number.isFinite(v) ? Math.round(v) : fallback;
  w = Math.min(96, Math.max(1, finite(w, 48))); h = Math.min(96, Math.max(1, finite(h, 32)));
  x = Math.max(bounds.x0, Math.min(bounds.x1 - w, finite(x, 0)));
  y = Math.max(bounds.y0, Math.min(bounds.y1 - h, finite(y, 0)));
  const view = viewport(e, x, y, w, h);
  return { worldId: e.id ?? null, v: VIEW_VERSION, tick: e.tick, seed: e.seed, mode: e.mode, bounds, summary: e.summary(), view, minimap: minimap(e),
    residents: e.creatures.map((c) => { const a = e.activity(c); return { id: c.id, name: c.name, x: c.x, y: c.y, health: Math.round(c.health), action: c.act?.prim ?? null, state: a.state, phase: a.phase, progress: a.progress, load: a.load, carrying: a.carrying, tools: a.tools, target: a.target, item: a.item, helping: a.helping, glyph: a.glyph, goal: c.plan?.goal?.kind ?? null, chain: chainStage(c) }; }),
    inspector: creature === null ? null : inspect(e, creature),
    chains: { totals: e.totals.chains ?? null, replans: e.totals.replans ?? {}, recent: (e.chainLog ?? []).slice(-40) },
    discoveries: e.discoveries.slice(-200), social: e.social.slice(-100),
    // Observer navigation only; never part of an agent's observation or memory.
    places: e.shelters.map(s => ({ id: s.id, x: s.x, y: s.y, biome: s.biome ?? e.biome(s.x,s.y), kind: s.kind, complete: s.complete !== false, ruined: s.complete !== false && s.integrity <= 0, integrity: Math.round(s.integrity), stored: units(s.store) })),
    limits: { residents: 'all living', discoveries: 200, social: 100, recentPlans: 8, observation: 'last decision, not current omniscient state' } };
}
