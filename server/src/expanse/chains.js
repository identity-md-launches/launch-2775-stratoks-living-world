// Demand perception, connected activity-chain tracking and bounded decision evidence (schema 5, additive fields).
// Nothing here assigns occupations or decides for a resident: demand is computed only from the resident's own
// observation and memory, and chains are RECORDED from the steps it actually completed (observer evidence).
// All state is bounded per resident (CHAIN_LIMITS) and per world (chainLog ring).

export const CHAINS_VERSION = 1;
export const CHAIN_LIMITS = Object.freeze({ decisions: 6, alternatives: 3, provenance: 6, stages: 6, log: 300, searchTicks: 900 });
const FOOD_KINDS = new Set(['bush', 'cactus', 'shellfish', 'lichen', 'fish']);
const MATERIALS = new Set(['wood', 'stone', 'fiber', 'stick', 'flint']);
// Tool upkeep (designed rule, documented in server/docs/CHAINS.md): which material mends which worn tool.
export const MEND = { hand_axe: { item: 'flint', restore: 0.5 }, fish_line: { item: 'fiber', restore: 0.5 } };

export function ensureChains(c) {
  const m = c.mind;
  m.decisions ??= []; m.prov ??= {}; m.food ??= null; m.search ??= null; m.chainStats ??= { materials: 0, food: 0, explore: 0, failed: 0 };
  return c;
}
export function ensureWorldChains(e) {
  e.chainLog ??= [];
  const t = e.totals;
  t.chains ??= { materials: { completed: 0, stored: 0, byUse: {}, ticks: 0, distance: 0 }, food: { completed: 0, byOutcome: {}, cooked: 0, ticks: 0 }, explore: { started: 0, found: 0, returned: 0, settled: 0, failed: 0, ticks: 0, distance: 0 } };
  t.replans ??= {}; t.mendUsed ??= {}; t.mended ??= {}; t.placed ??= {}; t.hauled ??= {}; t.surplusGathers ??= 0; t.demandGathers ??= 0;
}

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Materials this resident has a visible or remembered use for. Sources: perceived unfinished sites (missing
// materials), perceived or remembered worn shelters (<70 integrity) and its own worn tools. Memory may be stale.
export function materialDemand(e, c, obs) {
  const need = new Map();
  const add = (k, why) => { if (!need.has(k)) need.set(k, why); };
  for (const s of obs.shelters) {
    if (!s.complete) for (const k of s.missing ?? []) add(k, `site:${s.id}`);
    else if (!s.ruined && s.integrity < 70) for (const k of Object.keys(e.structureNeed(s.x, s.y))) add(k, `repair:${s.id}`);
  }
  for (const s of c.mind.shelters ?? []) if (s.complete !== false && !s.ruined && (s.integrity ?? 100) < 70 && cheb(s, c) <= 16)
    for (const k of Object.keys(e.structureNeed(s.x, s.y))) add(k, `repair:${s.id}`);
  for (const [tool, rule] of Object.entries(MEND)) if ((c.inventory[tool] ?? 0) > 0 && toolWearFrac(e, c, tool) >= 0.5) add(rule.item, `mend:${tool}`);
  // Already holding enough for the visible need: carrying more is surplus.
  for (const k of [...need.keys()]) if ((c.inventory[k] ?? 0) >= 4) need.delete(k);
  return need;
}
export function toolWearFrac(e, c, tool) { const uses = e.toolUses(tool); return uses ? (c.toolWear?.[tool] ?? 0) / uses : 0; }
// Food the resident itself holds and remembers at its home store (stale until revisited).
export function foodStock(c, isFood) {
  let held = 0; for (const [k, n] of Object.entries(c.inventory)) if (isFood(k)) held += n;
  const home = (c.mind.shelters ?? []).find((s) => s.x === c.home.x && s.y === c.home.y);
  let stored = null; if (home?.stock) { stored = 0; for (const [k, n] of Object.entries(home.stock)) if (isFood(k)) stored += n; }
  return { held, stored };
}
export function knowsSource(c, item, nodeKinds) {
  if (item === 'food') return Object.values(c.mind.known).some((k) => FOOD_KINDS.has(k.kind) && k.units > 0);
  return Object.values(c.mind.known).some((k) => nodeKinds[k.kind]?.item === item && k.units > 0);
}

// ---------------- decision evidence ----------------
// Real state at decision time and the scored alternatives; no fabricated thoughts.
export function recordDecision(c, entry) {
  ensureChains(c);
  c.mind.decisions.push(entry);
  if (c.mind.decisions.length > CHAIN_LIMITS.decisions) c.mind.decisions.shift();
}

// ---------------- chain tracking (observer evidence) ----------------
function log(e, ev) { e.chainLog.push(ev); if (e.chainLog.length > CHAIN_LIMITS.log) e.chainLog.shift(); }
function stage(p, s) { p.stages.push(s); if (p.stages.length > CHAIN_LIMITS.stages) p.stages.splice(1, 1); }

// A step finished successfully: update the resident's provenance records and close any chain it completes.
export function onStep(e, c, a, produced, consumed, extra = {}) {
  ensureChains(c); const m = c.mind, t = e.tick, here = { x: c.x, y: c.y };
  // Materials: acquire -> (transport/store/retrieve) -> use for construction, shelter repair or tool mending.
  for (const [k, q] of Object.entries(produced)) {
    if (!MATERIALS.has(k)) continue;
    if (a.prim === 'gather' || a.prim === 'carry' || a.prim === 'salvage') {
      const p = m.prov[k] ?? (m.prov[k] = { item: k, start: t, from: here, stages: [], stored: false });
      stage(p, `acquire:${a.prim}`);
    } else if (a.prim === 'retrieve') {
      const p = m.prov[k] ?? (m.prov[k] = { item: k, start: t, from: here, stages: [], stored: false });
      p.stored = true; stage(p, `retrieve:${a.shelter}`);
    }
  }
  for (const [k, q] of Object.entries(consumed)) {
    const p = m.prov[k];
    if (MATERIALS.has(k) && a.prim === 'deposit' && p) { p.stored = true; stage(p, `store:${a.shelter}`); }
    if (MATERIALS.has(k) && (a.prim === 'build' || a.prim === 'repair' || a.prim === 'mend')) {
      const use = a.prim === 'mend' ? `mend:${a.tool}` : a.prim === 'repair' ? (a.help !== undefined ? 'repair-help' : 'repair') : 'build';
      const from = p?.from ?? here, start = p?.start ?? t, dist = cheb(from, here);
      const T = e.totals.chains.materials;
      T.completed++; T.byUse[use] = (T.byUse[use] ?? 0) + 1; T.ticks += t - start; T.distance += dist; if (p?.stored) T.stored++;
      m.chainStats.materials++;
      log(e, { kind: 'materials', tick: t, resident: c.id, item: k, units: q, use, target: a.shelter ?? a.site ?? a.tool ?? null, stages: [...(p?.stages ?? ['held']), `use:${use}`], stored: !!p?.stored, distance: dist, ticks: t - start });
      if (p) delete m.prov[k];
    }
  }
  // Bound provenance to the most recent item kinds.
  const keys = Object.keys(m.prov); if (keys.length > CHAIN_LIMITS.provenance) { keys.sort((x, y) => m.prov[x].start - m.prov[y].start); delete m.prov[keys[0]]; }
  // Food: acquire -> (prepare) -> eat / share / provision, chosen from hunger and local stocks.
  const isFood = (k) => e.isFood(k);
  for (const [k] of Object.entries(produced)) if (isFood(k)) {
    if (a.prim === 'cook') { if (m.food) { m.food.item = k; m.food.cooked = true; stage(m.food, 'prepare:cook'); } else m.food = { item: k, start: t, stages: ['held', 'prepare:cook'], hunger: Math.round(c.hunger), cooked: true }; }
    else if (!m.food) m.food = { item: k, start: t, stages: [`acquire:${a.prim}${a.kind === 'fish' ? ':fish' : ''}`], hunger: Math.round(c.hunger), cooked: false, stock: extra.stock ?? null };
  }
  const f = m.food;
  if (f) for (const [k] of Object.entries(consumed)) if (isFood(k)) {
    const outcome = a.prim === 'use' && a.on === 'self' ? 'eaten' : a.prim === 'share' ? 'shared' : a.prim === 'deposit' && a.help !== undefined ? 'provisioned' : a.prim === 'deposit' ? 'stored' : null;
    if (!outcome) continue;
    const T = e.totals.chains.food;
    T.completed++; T.byOutcome[outcome] = (T.byOutcome[outcome] ?? 0) + 1; T.ticks += t - f.start; if (f.cooked) T.cooked++;
    m.chainStats.food++;
    log(e, { kind: 'food', tick: t, resident: c.id, item: k, outcome, cooked: f.cooked, stages: [...f.stages, outcome], hungerAtStart: f.hunger, hungerNow: Math.round(c.hunger), stockAtStart: f.stock ?? null, recipient: a.target ?? a.help ?? null, ticks: t - f.start });
    m.food = null; break;
  }
}

// Exploration for a needed resource: started by a `search` step, found when the resident perceives a source,
// closed when it returns home or settles (completes a shelter) away from home, or failed after searchTicks.
export function startSearch(e, c, item) {
  ensureChains(c);
  if (c.mind.search && !c.mind.search.closed) return;
  c.mind.search = { item, start: e.tick, from: { x: c.x, y: c.y }, home: { ...c.home }, found: null, far: 0 };
  e.totals.chains.explore.started++;
}
export function trackSearch(e, c, obs, nodeKinds) {
  const s = c.mind.search; if (!s) return null;
  s.far = Math.max(s.far, cheb(s.from, c));
  if (!s.found) {
    const hit = obs.nodes.find((n) => n.units > 0 && (s.item === 'food' ? FOOD_KINDS.has(n.kind) : nodeKinds[n.kind]?.item === s.item));
    if (hit) { s.found = { tick: e.tick, x: hit.x, y: hit.y, kind: hit.kind }; e.totals.chains.explore.found++; return 'found'; }
    if (e.tick - s.start > CHAIN_LIMITS.searchTicks) return closeSearch(e, c, 'failed');
    return null;
  }
  if (cheb(c, s.home) <= 3 && e.tick - s.found.tick > 0) return closeSearch(e, c, 'returned');
  if (e.tick - s.start > CHAIN_LIMITS.searchTicks * 2) return closeSearch(e, c, 'failed');
  return null;
}
export function settledSearch(e, c, shelter) { const s = c.mind?.search; if (s?.found && cheb(shelter, s.home) > 8) closeSearch(e, c, 'settled', shelter.id); }
function closeSearch(e, c, outcome, shelter = null) {
  const s = c.mind.search, T = e.totals.chains.explore;
  T[outcome]++; if (outcome !== 'failed') { T.ticks += e.tick - s.start; T.distance += s.far; c.mind.chainStats.explore++; } else c.mind.chainStats.failed++;
  log(e, { kind: 'explore', tick: e.tick, resident: c.id, item: s.item, outcome, found: s.found, from: s.from, farthest: s.far, ticks: e.tick - s.start, ...(shelter !== null ? { shelter } : {}) });
  c.mind.search = null;
  return outcome;
}
export function noteReplan(e, c, why) {
  e.totals.replans[why] = (e.totals.replans[why] ?? 0) + 1;
  ensureChains(c); const d = c.mind.decisions.at(-1); if (d && !d.interrupted) d.interrupted = { tick: e.tick, why };
}
