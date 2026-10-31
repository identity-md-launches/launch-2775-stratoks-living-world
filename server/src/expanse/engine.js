// Phase 2B "expanse" engine: authoritative, viewer-independent simulation of the extended chunked world.
// Pure: no I/O, no wall clock; all randomness from the world's seeded Rng (persisted).
import { Rng, hashSeed } from '../rng.js';
import { createBrain, inheritBrain, innateUtility, clamp } from '../brain.js';
import { ensureMushroom, encode, readout, reinforce, pickMushroom, MB_PARAMS } from '../mushroom.js';
import { World } from '../world.js';
import { DEFAULTS, deepMerge } from '../config.js';
import { CHUNK, BASE, T, MOVE_COST, FRESH, SALT, NODE_KINDS, CLIMATE, generateChunk, settleNode, chunkKey, chunkOf } from './terrain.js';
import { createMind, recordEpisode, modelKey, updateModel, predict, plan, rememberNode, rememberWater, rememberShelter, markVisited, LIMITS, MEMORY_VERSION, OBSERVATION_VERSION, PLANNER_VERSION } from './agent.js';
import { COOKING, COOK, CROPS, CROP, cropTemp, GLYPHS, cap } from './capabilities.js';
import { ensureAgency, updateGoals, goalBias, learnGoal, goalMetric, perceiveSignal, association, noteCooccurrence, trustBucket, updateTrust, salientCategory, SIGNAL } from './agency.js';
import { ensureChains, ensureWorldChains, materialDemand, toolWearFrac, foodStock, knowsSource, recordDecision, onStep, startSearch, trackSearch, settledSearch, noteReplan, MEND, CHAIN_LIMITS } from './chains.js';

export const EXPANSE_SCHEMA = 5;
export const MODES = ['full', 'frozen', 'no-planner'];
// Designer-defined material rules. Agents are NOT given this table: they only see generic affordances
// (combine any two held items, use any held item on a target) and learn results from transitions.
export const RECIPES = { 'flint+stick': 'hand_axe', 'stick+stone': 'stone_club', 'fiber+stick': 'bundle', 'bundle+fiber': 'fish_line' };
export const FOOD = { berry: { hunger: 20 }, cooked_berry: { hunger: 28 }, shellfish: { hunger: 26 }, cactus_fruit: { hunger: 10, thirst: 22 }, lichen: { hunger: 8 }, fish: { hunger: 30 }, cooked_fish: { hunger: 44 }, cooked_shellfish: { hunger: 36 }, cooked_lichen: { hunger: 16 } };
// Schema 4 designed rules (documented in server/docs/LIVING.md). Tools wear out after `uses` attempts.
export const TOOLS = { fish_line: { uses: 6, for: 'fish' }, hand_axe: { uses: 40, for: 'gather' }, stone_club: { uses: 20, for: 'attack' } };
// Shelters are biome-specific designs with explicit material needs, labour (ticks of work) and decay per tick.
export const STRUCTURES = {
  temperate: { kind: 'timber_home', need: { wood: 4, stone: 2 }, work: 30, decay: 0.005 },
  arid: { kind: 'desert_shade', need: { fiber: 3, stick: 2, stone: 1 }, work: 24, decay: 0.006 },
  cold: { kind: 'snow_refuge', need: { stone: 4, wood: 2 }, work: 36, decay: 0.01 },
  coast: { kind: 'coast_hut', need: { wood: 3, fiber: 2 }, work: 28, decay: 0.008 },
};
export const STORABLE = new Set(['berry', 'cooked_berry', 'shellfish', 'cactus_fruit', 'lichen', 'fish', 'wood', 'stone', 'fiber', 'stick', 'flint', 'cooked_fish', 'cooked_shellfish', 'cooked_lichen']);
export const FUEL = { wood: 6, stick: 2, fiber: 1, bundle: 4 };
export const WEIGHT = { wood: 2, stone: 2 };
const TOOL_GATHER = new Set(['tree', 'deadfall', 'driftwood', 'scrub']);
const SYL = ['ka', 'to', 'mi', 'ru', 'ne', 'so', 'la', 'bo', 'zi', 'pe', 'du', 'fa', 'ye', 'gu', 'ha', 'vi'];

export const EXPANSE_DEFAULTS = {
  radiusChunks: 4,          // chunks added on every side of the 2x2-chunk settlement: (2+2r)^2/4 = 25x area at r=4
  initialCount: 24, mode: 'full', learning: true,
  maxDecisionsPerTick: 64, perception: 7, nightPerception: 5, dayLength: 1200,
  hungerRate: 0.045, thirstRate: 0.06, adultAge: 1500, elderAge: 14000, lifespanBase: 20000,
  invCapacity: 12, eventRing: 400, socialRing: 300, graveyardMax: 5000, historyEvery: 100, historyMax: 1000,
  rewardReversal: null,     // { item:'berry', fromTick } makes that food harmful from fromTick (experiment hook)
  planner: { bonus: 0.6, lambda: 0.03, mu: 0.02, gamma: 0.9, scale: 1.0 },
  observeWeight: 0.3,
  // Schema 4 life loop.
  storeCapacity: 40, repairAmount: 30, decayEvery: 50, fishBite: 0.6, fishSight: 3, heatTemp: 30,
  // Schema 5: persistent goals (designed triggers, learned goal->step model) and limited learned signalling.
  goals: true, goalWeight: 0.5, communication: true,
};

export class Expanse {
  constructor(cfg) { this.cfg = deepMerge(EXPANSE_DEFAULTS, cfg ?? {}); }

  // ---------------- creation ----------------
  static create(cfg = {}, opts = {}) {
    const e = new Expanse(cfg);
    const seed = opts.seed ?? cfg.seed ?? DEFAULTS.world.seed;
    // The preserved settlement is produced by the unchanged Phase 2A generator (same seed => same terrain & IDs).
    const legacyCfg = deepMerge(DEFAULTS, { world: { seed, brainMode: 'mb-v1', initialSeedCount: e.cfg.initialCount } });
    const legacy = opts.legacyWorld ?? World.create(legacyCfg);
    e.initFrom(seed, legacy.toState ? legacy.toState() : legacy);
    return e;
  }
  initFrom(seed, s) {
    this.seed = seed; this.schema = EXPANSE_SCHEMA; this.rng = new Rng(hashSeed(`stratoks:expanse:${seed}`));
    this.tick = s.tick ?? 0; this.seq = 0; this.mode = this.cfg.mode; this.learning = this.cfg.learning;
    this.base = { tiles: typeof s.tiles === 'string' ? Uint8Array.from(Buffer.from(s.tiles, 'base64')) : Uint8Array.from(s.tiles), trees: s.trees, stones: s.stones, bushes: s.bushes };
    this.chunks = new Map(); this.fires = []; this.shelters = []; this.events = []; this.social = []; this.discoveries = []; this.history = [];
    this.graveyard = (s.graveyard ?? []).slice(-this.cfg.graveyardMax);
    this.nextId = { creature: s.nextId?.creature ?? 1, fire: 1, shelter: 1, pile: 1, plan: 1, crop: 1, signal: 1 }; this.crops = []; this.signals = [];
    this.totals = { births: 0, deaths: 0, deathsByCause: {}, gathered: {}, regrown: {}, eaten: {}, burnedNodes: {}, burnedItems: {}, built: {}, crafted: {}, craftUsed: {}, repaired: {}, wornOut: {}, deposited: {}, retrieved: {}, ...schema5Totals(), decisions: 0, deferred: 0, planned: 0, reflex: 0, ...(s.legacyTotals ? { legacy: s.legacyTotals } : {}) };
    this.weather = { rain: false, until: 0 }; this.chainLog = []; ensureWorldChains(this);
    for (const sh of s.shelters ?? []) if (sh.complete || sh.stage === 3 || sh.done) this.shelters.push(prebuiltShelter({ id: this.nextId.shelter++, x: sh.x, y: sh.y, cap: 4, integrity: sh.integrity ?? 100, legacyId: sh.id }, this.biome(sh.x, sh.y)));
    this.creatures = (s.creatures ?? []).map((c) => this.adoptCreature(c));
    this.emit('expanse_created', { seed, chunks: this.extentChunks(), note: 'Phase 2B extension around the preserved 56x56 settlement' });
  }
  // Keeps all legacy fields (ids, coordinates, brain incl. mb-v1 weights, memories, relationships, personality).
  adoptCreature(c) {
    c.thirst ??= 20; c.warmth ??= 90; c.injury ??= 0; c.inventory ??= {}; c.reputation ??= {}; c.relationships ??= {};
    c.energy = clamp(c.energy ?? 80, 0, 100);
    c.mind ??= createMind(); c.plan ??= null; c.act = null; c.path = []; c.following ??= null; c.followers ??= {};
    c.mind.shelters ??= []; c.mind.memoryVersion = MEMORY_VERSION;
    c.home ??= { x: Math.round(c.x), y: Math.round(c.y) }; c.x = Math.round(c.x); c.y = Math.round(c.y);
    c.lifespan ??= this.cfg.lifespanBase; c.cooldown ??= 0; c.stats ??= {}; c.stats.moved ??= 0; c.carrying = null; c.toolWear ??= {}; c.fromStore ??= {};
    if (c.inside !== undefined) delete c.inside;
    ensureAgency(c); c.mind.homes ??= {}; ensureChains(c);
    ensureMushroom(c.brain, this.seed, c.id);
    return c;
  }
  extentChunks() { const r = this.cfg.radiusChunks; return { cx0: -r, cx1: 1 + r, cy0: -r, cy1: 1 + r }; }
  bounds() { const e = this.extentChunks(); return { x0: e.cx0 * CHUNK, y0: e.cy0 * CHUNK, x1: (e.cx1 + 1) * CHUNK, y1: (e.cy1 + 1) * CHUNK }; }

  // ---------------- chunks / terrain access ----------------
  chunk(cx, cy) {
    const e = this.ext ??= this.extentChunks();
    if (cx < e.cx0 || cx > e.cx1 || cy < e.cy0 || cy > e.cy1) return null;
    const fk = (cy + 512) * 1024 + cx + 512;
    this.fast ??= new Map();
    let ch = this.fast.get(fk);
    if (ch) return ch;
    const k = chunkKey(cx, cy);
    ch = this.chunks.get(k);
    if (!ch) { ch = generateChunk(this.seed, cx, cy, this.base); this.indexChunk(ch); this.chunks.set(k, ch); }
    this.fast.set(fk, ch);
    return ch;
  }
  indexChunk(ch) { ch.at = new Map(); for (const n of ch.nodes) ch.at.set(n.y * 100000 + n.x, n); ch.pileAt = new Map(); for (const p of ch.piles) ch.pileAt.set(p.y * 100000 + p.x, p); }
  chunkAt(x, y) { return this.chunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK)); }
  tile(x, y) { const ch = this.chunkAt(x, y); if (!ch) return T.CLIFF; return ch.tiles[(y - ch.cy * CHUNK) * CHUNK + (x - ch.cx * CHUNK)]; }
  biome(x, y) { const ch = this.chunkAt(x, y); return ch ? ch.biome[(y - ch.cy * CHUNK) * CHUNK + (x - ch.cx * CHUNK)] : 'cold'; }
  nodeAt(x, y) { const ch = this.chunkAt(x, y); const n = ch?.at.get(y * 100000 + x); return n ? this.settle(n) : null; }
  pileAt(x, y) { return this.chunkAt(x, y)?.pileAt.get(y * 100000 + x) ?? null; }
  // Lazily evaluate regrowth. Nodes that are dead or already full are returned untouched: settleNode would only
  // stamp n.t with the read tick, a read-only mutation that is invisible to snapshots (only dirty chunks are
  // saved) and so made a reloaded world serialize differently from an uninterrupted one. Every real change to
  // n.t comes from a depletion/regrowth event, and those mark the chunk dirty.
  settle(n) {
    if (n.dead || n.units >= NODE_KINDS[n.kind].max) return n;
    const before = n.units; settleNode(n, this.tick); if (n.units > before) { const it = NODE_KINDS[n.kind].item; this.totals.regrown[it] = (this.totals.regrown[it] ?? 0) + n.units - before; this.dirty(n.x, n.y); } return n;
  }
  moveCost(x, y) {
    const c = MOVE_COST[this.tile(x, y)]; if (c === Infinity) return Infinity;
    const n = this.chunkAt(x, y).at.get(y * 100000 + x);
    if (n && NODE_KINDS[n.kind].blocks && n.units > 0) return Infinity;
    return c;
  }
  passable(x, y) { return this.moveCost(x, y) !== Infinity; }
  nodesNear(x, y, r, settle = true) {
    const out = [];
    for (let cy = Math.floor((y - r) / CHUNK); cy <= Math.floor((y + r) / CHUNK); cy++) for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) {
      const ch = this.chunk(cx, cy); if (!ch) continue;
      for (const n of ch.nodes) if (Math.abs(n.x - x) <= r && Math.abs(n.y - y) <= r) out.push(settle ? this.settle(n) : n);
    }
    return out;
  }
  dirty(x, y) { const ch = this.chunkAt(x, y); if (ch) ch.dirty = true; }

  // ---------------- climate ----------------
  daylight() { return Math.sin(2 * Math.PI * (this.tick % this.cfg.dayLength) / this.cfg.dayLength); }
  ambient(x, y) {
    const b = CLIMATE[this.biome(x, y)], tl = this.tile(x, y);
    let t = b.t + b.swing * this.daylight();
    if (tl === T.SNOW) t -= 3; if (tl === T.SHALLOW || tl === T.STREAM) t -= 6; if (this.weather.rain) t -= 3;
    return t;
  }
  fireWarmth(x, y) { let w = 0; for (const f of this.fires) { const d = Math.max(Math.abs(f.x - x), Math.abs(f.y - y)); if (d <= 1) w = Math.max(w, 20); else if (d <= 3) w = Math.max(w, 10); } return w; }
  // Only a finished, standing shelter protects; construction sites and ruins (integrity 0) do not.
  shelterAt(x, y) { return this.shelters.find((s) => s.x === x && s.y === y && usable(s)) ?? null; }
  effectiveTemp(c) {
    let t = this.ambient(c.x, c.y) + this.fireWarmth(c.x, c.y);
    const sh = this.shelterAt(c.x, c.y);
    if (sh) { const q = Math.min(1, sh.integrity / 40); if (t < 17) t += (17 - t) * q; else if (t > 26) t -= (t - 26) * 0.6 * q; } // insulation / shade, weaker when worn
    return t;
  }

  // ---------------- events ----------------
  emit(type, data = {}) { const ev = { seq: ++this.seq, tick: this.tick, type, ...data }; this.events.push(ev); if (this.events.length > this.cfg.eventRing) this.events.shift(); return ev; }
  socialEvent(type, actor, target, result) {
    const ev = { tick: this.tick, type, actor: actor.id, target: target?.id ?? null, result };
    this.social.push(ev); if (this.social.length > this.cfg.socialRing) this.social.shift();
    // Reputation: every creature that can perceive the act updates its own opinion of the actor.
    const delta = { share: 0.08, help: 0.05, attack: -0.15, threaten: -0.06, refuse: -0.02, follow: 0.02 }[type] ?? 0;
    if (delta) for (const o of this.creaturesNear(actor.x, actor.y, this.cfg.perception)) if (o !== actor) o.reputation[actor.id] = clamp((o.reputation[actor.id] ?? 0) + delta, -1, 1);
    return ev;
  }

  // ---------------- creatures ----------------
  newName() { const r = this.rng; const n = SYL[r.int(16)] + SYL[r.int(16)] + (r.next() < 0.5 ? SYL[r.int(16)] : ''); return n[0].toUpperCase() + n.slice(1); }
  newCreature({ x, y, sex, age, parents = [], parentsObj = [] }) {
    const r = this.rng, personality = { boldness: r.next(), sociability: r.next(), diligence: r.next(), curiosity: r.next(), caution: r.next() };
    const brain = parentsObj.length ? inheritBrain(r, parentsObj[0]?.brain, parentsObj[1]?.brain, 0.5, 0.05, personality) : createBrain(r, personality);
    const c = { id: this.nextId.creature++, name: this.newName(), sex, age, bornTick: this.tick - age, x, y, face: 1, hunger: 20, thirst: 20, energy: 80, health: 100, warmth: 90,
      personality, brain, lifespan: Math.round(this.cfg.lifespanBase * r.range(0.8, 1.2)), parents, generation: parentsObj.length ? 1 + Math.max(...parentsObj.map((p) => p.generation ?? 0)) : 0,
      relationships: {}, memories: [], stats: { eaten: 0, gathered: 0, built: 0, social: 0, hurt: 0, offspring: 0, decisions: 0, moved: 0 }, partner: null, cooldown: 0, pregnant: null };
    return this.adoptCreature(c);
  }
  getCreature(id) { return this.creatures.find((c) => c.id === id); }
  rebuildIndex() { this.grid = new Map(); for (const c of this.creatures) { const k = `${c.x >> 4},${c.y >> 4}`; let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(c); } }
  creaturesNear(x, y, r) {
    if (!this.grid) this.rebuildIndex();
    const out = [];
    for (let gy = (y - r) >> 4; gy <= (y + r) >> 4; gy++) for (let gx = (x - r) >> 4; gx <= (x + r) >> 4; gx++) for (const c of this.grid.get(`${gx},${gy}`) ?? []) if (Math.abs(c.x - x) <= r && Math.abs(c.y - y) <= r && c.health > 0) out.push(c);
    return out;
  }
  invWeight(c) { let w = 0; for (const [k, n] of Object.entries(c.inventory)) w += (WEIGHT[k] ?? 1) * n; return w; }
  spendEnergy(c, amount) {
    if (c.energy + 1e-9 < amount) return false;
    c.energy = Math.max(0, c.energy - amount);
    return true;
  }
  addItem(c, item, n = 1) { c.inventory[item] = (c.inventory[item] ?? 0) + n; }
  takeItem(c, item, n = 1) { if ((c.inventory[item] ?? 0) < n) return false; c.inventory[item] -= n; if (!c.inventory[item]) delete c.inventory[item]; return true; }
  isAdult(c) { return c.age >= this.cfg.adultAge; }
  isFood(k) { return FOOD[k] !== undefined; }
  toolUses(tool) { return TOOLS[tool]?.uses ?? 0; }
  structureNeed(x, y) { return STRUCTURES[this.biome(x, y)]?.need ?? {}; }
  // Fire demand the resident itself feels: cold, a carried raw meal, or a locally perceived cookable source when
  // hunger is rising. A fire made from this demand is a shared resource, not a spawned prop.
  fireDemand(c, obs) {
    const heldMeal = Object.keys(c.inventory).some((k) => c.inventory[k] > 0 && cap(k, 'heatable'));
    const nearbyMeal = obs.nodes.some((n) => n.units > 0 && cap(NODE_KINDS[n.kind]?.item, 'heatable'));
    return c.warmth < 70 || obs.self.temp < 8 || (c.hunger > 5 && heldMeal) || (c.hunger > 20 && nearbyMeal);
  }
  // Wear one use of a held tool; at its limit it is used up (accounted as wornOut).
  wearTool(c, tool) {
    if (!c.inventory[tool] || !TOOLS[tool]) return;
    c.toolWear[tool] = (c.toolWear[tool] ?? 0) + 1;
    if (c.toolWear[tool] >= TOOLS[tool].uses) { this.takeItem(c, tool); c.toolWear[tool] = 0; this.totals.wornOut[tool] = (this.totals.wornOut[tool] ?? 0) + 1; this.emit('tool_worn', { by: c.id, tool }); }
  }

  // ---------------- perception & observation (interface v2) ----------------
  perceive(c) {
    const r = this.daylight() < -0.3 ? this.cfg.nightPerception : this.cfg.perception, m = c.mind;
    // Fish under water are only seen from the shore (fishSight), not across the whole perception radius.
    const sight = (n) => n.kind !== 'fish' || Math.max(Math.abs(n.x - c.x), Math.abs(n.y - c.y)) <= this.cfg.fishSight;
    const nodes = this.nodesNear(c.x, c.y, r).filter((n) => !n.dead && sight(n));
    for (const n of nodes) rememberNode(m, n, this.tick);
    for (const id of Object.keys(m.known)) { const k = m.known[id]; if (Math.abs(k.x - c.x) <= r && Math.abs(k.y - c.y) <= r && sight(k) && !nodes.some((n) => n.id === id)) delete m.known[id]; }
    let fresh = null, salt = null;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const t = this.tile(c.x + dx, c.y + dy);
      if (FRESH.has(t) && (!fresh || Math.abs(dx) + Math.abs(dy) < fresh.d)) fresh = { x: c.x + dx, y: c.y + dy, d: Math.abs(dx) + Math.abs(dy) };
      if (SALT.has(t) && (!salt || Math.abs(dx) + Math.abs(dy) < salt.d)) salt = { x: c.x + dx, y: c.y + dy, d: Math.abs(dx) + Math.abs(dy) };
    }
    if (fresh) rememberWater(m, fresh.x, fresh.y, this.tick);
    const novel = markVisited(m, c.x, c.y);
    const fires = this.fires.filter((f) => Math.abs(f.x - c.x) <= r && Math.abs(f.y - c.y) <= r);
    // Fires are remembered only after being seen. Keep the field absent until then, preserving older snapshots
    // byte-for-byte; a later action resolves the id against the world so an extinguished fire replans safely.
    if (fires.length || m.fires?.length) {
      m.fires ??= [];
      for (const f of fires) {
        const known = m.fires.find((q) => q.id === f.id);
        if (known) Object.assign(known, { x: f.x, y: f.y, t: this.tick }); else m.fires.push({ id: f.id, x: f.x, y: f.y, t: this.tick });
      }
      m.fires = m.fires.filter((f) => Math.abs(f.x - c.x) > r || Math.abs(f.y - c.y) > r || fires.some((q) => q.id === f.id));
      if (m.fires.length > 6) m.fires.sort((a, b) => b.t - a.t).splice(6);
    }
    const shelters = this.shelters.filter((s) => Math.abs(s.x - c.x) <= r && Math.abs(s.y - c.y) <= r);
    // Sight records appearance only (finished / ruined / wear); store contents are learned only by visiting.
    for (const s of shelters) if (s.complete !== false) rememberShelter(m, s, this.tick, false);
    const others = this.creaturesNear(c.x, c.y, r).filter((o) => o !== c).slice(0, 8);
    // Whose home is which shelter is learned only by seeing a resident resting at it.
    for (const o of others) { const sh = shelters.find((s) => s.x === o.x && s.y === o.y && s.complete !== false); if (sh && o.home.x === sh.x && o.home.y === sh.y && o.act?.prim === 'rest') { m.homes[o.id] = sh.id; const k = Object.keys(m.homes); if (k.length > 8) delete m.homes[k[0]]; } }
    const crops = this.crops.filter((q) => Math.abs(q.x - c.x) <= r && Math.abs(q.y - c.y) <= r);
    const piles = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const p = this.pileAt(c.x + dx, c.y + dy); if (p) piles.push(p); }
    const obs = {
      version: OBSERVATION_VERSION, tick: this.tick, radius: r, novelCell: novel,
      self: { x: c.x, y: c.y, hunger: c.hunger, thirst: c.thirst, energy: c.energy, health: c.health, warmth: c.warmth, injury: c.injury, inventory: { ...c.inventory }, temp: Math.round(this.effectiveTemp(c) * 10) / 10 },
      ambient: { biome: this.biome(c.x, c.y), tile: this.tile(c.x, c.y), daylight: Math.round(this.daylight() * 100) / 100, rain: this.weather.rain },
      nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y, units: n.units })).slice(0, 24),
      water: fresh ? { x: fresh.x, y: fresh.y } : null, saltWater: salt ? { x: salt.x, y: salt.y } : null,
      fires: fires.map((f) => ({ id: f.id, x: f.x, y: f.y })),
      shelters: shelters.map((s) => ({ id: s.id, x: s.x, y: s.y, integrity: Math.round(s.integrity), kind: s.kind, complete: s.complete !== false, stage: s.stage ?? 3, ruined: s.complete !== false && s.integrity <= 0, ...(s.complete !== false ? {} : { missing: missingMaterials(s), work: s.work, workNeed: s.workNeed }) })), piles: piles.map((p) => ({ id: p.id, x: p.x, y: p.y, items: { ...p.items } })),
      creatures: others.map((o) => ({ id: o.id, x: o.x, y: o.y, act: o.act?.prim ?? null, health: Math.round(o.health), holding: Object.keys(o.inventory).slice(0, 3), thin: o.hunger > 60 })),
      // Crops look growing or ripe; dry soil is visible. The growth rule itself is not observed.
      crops: crops.map((q) => ({ id: q.id, x: q.x, y: q.y, kind: q.kind, ripe: q.ripe, dry: q.moisture <= 0 })),
      heard: (m.heard ?? []).filter((h) => this.tick - h.tick <= SIGNAL.ttl).map((h) => ({ ...h })),
    };
    c.lastObs = obs;
    return obs;
  }
  features(c, obs) {
    const foodKinds = new Set(['bush', 'cactus', 'shellfish', 'lichen', 'fish']);
    const foodNear = obs.nodes.some((n) => foodKinds.has(n.kind) && n.units > 0), foodKnown = Object.values(c.mind.known).some((k) => foodKinds.has(k.kind));
    const fireOn = obs.fires.some((f) => f.x === c.x && f.y === c.y);
    const shelterKnown = obs.shelters.some((s) => s.complete && s.integrity > 0) || c.mind.shelters.some((s) => s.complete !== false && (s.integrity ?? 100) > 0 && !s.ruined);
    return [c.hunger / 100, 1 - c.energy / 100, 1 - c.health / 100, foodNear ? 1 : 0, foodKnown ? 1 : 0, shelterKnown ? 0 : 1, this.invWeight(c) / this.cfg.invCapacity, 0,
      obs.creatures.length ? 1 : 0, fireOn || c.injury > 0 ? 1 : 0, obs.ambient.rain ? 1 : 0, obs.creatures.length ? 0 : 1];
  }
  cues(c, obs) { return [c.thirst / 100, 1 - c.warmth / 100, obs.fires.length ? 1 : 0, c.inventory.hand_axe ? 1 : 0]; }

  // ---------------- affordances (interface v2) ----------------
  // Generic: every visible/known node can be gathered/inspected, any two held item kinds can be combined, any held
  // item can be used on self, a nearby fire or a pile, or placed. No recipe or ignition rule is consulted here.
  affordances(c, obs, demand = materialDemand(this, c, obs)) {
    const ctxTool = c.inventory.hand_axe ? 'tool' : 'bare';
    const nearest = new Map();
    for (const [id, k] of Object.entries(c.mind.known)) {
      if (k.units <= 0) continue;
      const d = Math.max(Math.abs(k.x - c.x), Math.abs(k.y - c.y));
      const cur = nearest.get(k.kind); if (!cur || d < cur.d) nearest.set(k.kind, { id, ...k, d });
    }
    const pileHere = obs.piles.find((p) => p.x === c.x && p.y === c.y), fireNear = obs.fires.slice().sort((a, b) => Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)) - Math.max(Math.abs(b.x - c.x), Math.abs(b.y - c.y)))[0];
    const water = c.mind.water.slice().sort((a, b) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y) - Math.abs(b.x - c.x) - Math.abs(b.y - c.y))[0];
    return (inv, prev) => {
      const out = [];
      const full = Object.entries(inv).reduce((s, [k, n]) => s + (WEIGHT[k] ?? 1) * n, 0) >= this.cfg.invCapacity;
      const held = Object.keys(inv).filter((k) => inv[k] > 0).sort();
      const preparingMeal = !obs.fires.length && (c.personality?.diligence ?? 0.5) >= 0.6 && held.some((k) => COOKING[k]);
      const heldCookable = held.some((k) => cap(k, 'heatable'));
      const mealInputs = new Set(['wood', 'flint', 'stone']);
      const tool = inv.hand_axe ? 'tool' : ctxTool === 'tool' && inv.hand_axe !== 0 ? 'tool' : 'bare';
      for (const it of held) if (FOOD[it] !== undefined || it === 'berry') {
        // Keep a cookable meal while a resident can still deliberately prepare it. At severe hunger the normal
        // raw-food fallback returns, so unreachable fuel or a failed fire cannot starve the resident.
        if (preparingMeal && COOKING[it] && c.hunger < 75) continue;
        out.push({ prim: 'use', item: it, on: 'self', key: modelKey('use', `${it}@self`), consumes: [it], label: 'EAT' });
      }
      if (!full) for (const n of nearest.values()) {
        const space = Math.floor((this.cfg.invCapacity - Object.entries(inv).reduce((s, [k, q]) => s + (WEIGHT[k] ?? 1) * q, 0)) / (WEIGHT[NODE_KINDS[n.kind]?.item] ?? 1));
        const quantity = Math.min(tool === 'tool' && TOOL_GATHER.has(n.kind) ? 2 : 1, n.units, space);
        const ctx = n.kind === 'fish' ? (inv.fish_line ? 'line' : 'bare') : TOOL_GATHER.has(n.kind) ? tool : '';
        if (quantity > 0 && c.energy >= 1.2 * quantity) out.push({ prim: 'gather', node: n.id, kind: n.kind, x: n.x, y: n.y, key: modelKey('gather', n.kind, ctx), label: ['stone', 'flint'].includes(n.kind) ? 'GATHER_STONE' : ['bush', 'cactus', 'shellfish', 'lichen', 'fish'].includes(n.kind) ? 'EAT' : 'GATHER_WOOD' });
      }
      if (water) out.push({ prim: 'use', item: null, on: 'water', x: water.x, y: water.y, key: modelKey('drink', 'known-fresh'), label: 'EAT' });
      if (obs.saltWater && !prev) out.push({ prim: 'use', item: null, on: 'water', x: obs.saltWater.x, y: obs.saltWater.y, key: modelKey('drink', 'sea'), label: 'EAT', firstOnly: true });
      if (c.energy >= 1) for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
        // Keep the locally perceived fire inputs together until the resident can attempt the preparation it chose.
        if (preparingMeal && (mealInputs.has(held[i]) || mealInputs.has(held[j]))) continue;
        out.push({ prim: 'combine', a: held[i], b: held[j], key: modelKey('combine', `${held[i]}+${held[j]}`), consumes: [], label: 'GATHER_WOOD' });
      }
      // Placing fuel is offered only with a felt fire demand (cold, raw food while hungry) or onto an existing pile,
      // and onto a perceived pile within 2 tiles when there is one, so fuel is consolidated instead of scattered.
      const fireWanted = this.fireDemand(c, obs), pileNear = pileHere ?? obs.piles.filter((p) => !this.shelters.some((s) => s.x === p.x && s.y === p.y)).sort((a, b) => Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)) - Math.max(Math.abs(b.x - c.x), Math.abs(b.y - c.y)) || (a.id < b.id ? -1 : 1))[0];
      // Starting a new fire is only offered when this resident can finish the local sequence now. This prevents
      // hungry residents from scattering a fuel pile they cannot ignite after walking away.
      // Flint struck on stone is most reliable; an ordinary sharp stone is a slower, less reliable fallback. Both
      // consume only the fuel placed on the ground, so no material is conjured to bootstrap a settlement fire.
      const canIgnite = (!!inv.flint && !!inv.stone) || !!inv.stone;
      const canStartHere = c.warmth < 70 || obs.self.temp < 8 || heldCookable;
      for (const it of held) {
        if (FUEL[it] && ((canStartHere && (pileHere || canIgnite)) || pileHere)) out.push({ prim: 'place', item: it, purpose: fireWanted ? 'prepare-fire' : undefined, ...(pileNear && !pileHere ? { x: pileNear.x, y: pileNear.y } : {}), key: modelKey('place', it, pileNear ? 'pile' : 'ground'), consumes: [it], label: 'GATHER_WOOD' });
        const striker = (it === 'flint' && inv.stone) || it === 'stone';
        // When this pile was deliberately made for a needed meal, keep the next attempt to a viable striker;
        // trying to rub the fuel/food itself on the pile is neither a useful replan nor a cooking demonstration.
        if (c.energy >= 1.5 && (prev?.prim === 'place' || pileHere) && (!fireWanted || !canIgnite || striker)) out.push({ prim: 'use', item: it, on: 'pile', purpose: striker ? 'prepare-fire' : undefined, key: modelKey('use', `${it}@pile`), consumes: [it], label: 'GATHER_WOOD' });
        if (fireNear && c.energy >= 1) out.push({ prim: 'use', item: it, on: 'fire', fire: fireNear.id, x: fireNear.x, y: fireNear.y, key: modelKey('use', `${it}@fire`), consumes: [it], label: 'GATHER_WOOD' });
      }
      if (pileHere && !full && !prev) for (const it of Object.keys(pileHere.items).slice(0, 3)) out.push({ prim: 'carry', item: it, key: modelKey('carry', it), label: 'GATHER_WOOD' });
      // Hauling: pick up a perceived ground pile nearby when its material has a visible use or a known store has room.
      if (!pileHere && !full && !prev) {
        const room = (c.mind.shelters ?? []).some((s) => s.complete !== false && !s.ruined && (s.integrity ?? 100) > 0 && (!s.stock || sum(s.stock) < this.cfg.storeCapacity));
        for (const p of obs.piles) {
          const it = Object.keys(p.items).filter((k) => p.items[k] > 0 && (demand.has(k) || (room && STORABLE.has(k)))).sort((a, b) => (demand.has(b) ? 1 : 0) - (demand.has(a) ? 1 : 0) || (a < b ? -1 : 1))[0];
          if (it) { out.push({ prim: 'carry', item: it, x: p.x, y: p.y, haul: true, key: modelKey('carry', it, demand.has(it) ? 'needed' : 'haul'), label: 'GATHER_WOOD' }); break; }
        }
      }
      // Tool upkeep: mend a worn held tool with its designed material.
      if (c.energy >= 1) for (const [tool, rule] of Object.entries(MEND)) if ((inv[tool] ?? 0) > 0 && (inv[rule.item] ?? 0) > 0 && (c.toolWear?.[tool] ?? 0) > 0)
        out.push({ prim: 'mend', tool, item: rule.item, key: modelKey('mend', tool), consumes: [rule.item], label: 'GATHER_STONE' });
      this.livingAffordances(c, obs, inv, prev, out, full, preparingMeal);
      if (!prev) {
        const shelterHere = obs.shelters.some((s) => s.x === c.x && s.y === c.y && s.complete && !s.ruined);
        out.push({ prim: 'rest', key: modelKey('rest', fireNear ? 'fire' : shelterHere ? 'shelter' : 'open', obs.ambient.biome), label: 'REST', x: fireNear?.x, y: fireNear?.y });
        const sh = this.nearestKnownShelter(c);
        if (sh && (sh.x !== c.x || sh.y !== c.y)) out.push({ prim: 'move', x: sh.x, y: sh.y, purpose: 'shelter', key: modelKey('move', 'to-shelter', obs.ambient.rain ? 'rain' : ''), label: 'REST' });
        out.push({ prim: 'move', purpose: 'explore', key: modelKey('move', 'explore', obs.ambient.biome), label: 'WANDER' });
        // Exploring for a needed resource that this resident knows no source of (hungry, or a visible material need).
        const wantFood = c.hunger > 45 && !knowsSource(c, 'food', NODE_KINDS) && !Object.keys(inv).some((k) => FOOD[k]);
        const wantMat = [...demand.keys()].find((k) => !(inv[k] > 0) && !knowsSource(c, k, NODE_KINDS));
        const want = c.mind.search?.item ?? (wantFood ? 'food' : wantMat ?? null);
        if (want && !c.mind.search?.found) out.push({ prim: 'move', purpose: 'search', item: want, key: modelKey('move', 'search', want === 'food' ? 'food' : 'material'), label: 'WANDER' });
        if (Math.max(Math.abs(c.home.x - c.x), Math.abs(c.home.y - c.y)) > (c.mind.search?.found ? 3 : 12)) out.push({ prim: 'move', x: c.home.x, y: c.home.y, purpose: 'home', key: modelKey('move', 'home'), label: 'WANDER' });
        for (const n of obs.nodes.slice(0, 3)) if (!c.mind.model[modelKey('inspect', n.kind)]) out.push({ prim: 'inspect', node: n.id, kind: n.kind, x: n.x, y: n.y, key: modelKey('inspect', n.kind), label: 'WANDER' });
        for (const o of obs.creatures.slice(0, 3)) this.socialAffordances(c, o, inv, out);
        if (this.cfg.communication) this.signalAffordances(c, obs, out);
      }
      return out;
    };
  }
  // Limited learned signalling. A resident may emit any neutral glyph; its own salient perception is part of the
  // learned key, so which glyph it uses in which situation is learned from credited outcomes, not a dictionary.
  // A heard glyph can be followed to where it was emitted; whether that pays is learned per glyph and trust.
  signalAffordances(c, obs, out) {
    const ctx = salientCategory(obs, c);
    if (obs.creatures.length && this.tick >= (c.signalCooldown ?? 0) && c.energy >= 1) {
      const scored = GLYPHS.map((g, i) => ({ g, v: predict(c.mind, modelKey('signal', g, ctx)).reward, i })).sort((a, b) => b.v - a.v || a.i - b.i);
      const trial = GLYPHS[(c.id + Math.floor(this.tick / 97)) % GLYPHS.length];
      for (const g of [...new Set([scored[0].g, trial])]) out.push({ prim: 'signal', glyph: g, ctx, key: modelKey('signal', g, ctx), label: 'SOCIALIZE' });
    }
    const heard = obs.heard.filter((h) => h.from !== c.id && Math.max(Math.abs(h.x - c.x), Math.abs(h.y - c.y)) > 0).slice(-2);
    for (const h of heard) out.push({ prim: 'move', purpose: 'respond', x: h.x, y: h.y, glyph: h.glyph, from: h.from, sig: h.sig, key: modelKey('respond', h.glyph, trustBucket(c, h.from)), label: 'APPROACH' });
  }
  socialAffordances(c, o, inv, out) {
    const rel = c.relationships[o.id] ?? 0, rep = c.reputation[o.id] ?? 0;
    const food = Object.keys(inv).find((k) => FOOD[k] && inv[k] > 0);
    if (food) out.push({ prim: 'share', target: o.id, item: food, key: modelKey('share', food, rel > 0.3 ? 'friend' : 'other'), consumes: [food], label: 'SOCIALIZE' });
    if (!c.following && rep > 0.05 && o.health >= 30) out.push({ prim: 'follow', target: o.id, key: modelKey('follow', rep > 0.3 ? 'reputable' : 'known'), label: 'SOCIALIZE' });
    out.push({ prim: 'socialize', target: o.id, key: modelKey('socialize', rel > 0.3 ? 'friend' : 'other'), label: 'SOCIALIZE' });
    const competing = c.hunger > 55 && o.act === 'gather';
    if ((competing || (c.lastAttacker === o.id)) && this.isAdult(c)) {
      if (c.energy >= 2) out.push({ prim: 'threaten', target: o.id, key: modelKey('threaten', competing ? 'food' : 'retaliate'), label: 'APPROACH' });
      if (c.energy >= 5) out.push({ prim: 'attack', target: o.id, key: modelKey('attack', competing ? 'food' : 'retaliate', inv.stone_club || inv.hand_axe ? 'armed' : 'bare'), label: 'APPROACH' });
    }
    if (c.lastAttacker === o.id || c.threatenedBy === o.id) out.push({ prim: 'flee', from: o.id, key: modelKey('flee', 'threat'), label: 'FLEE' });
  }
  // Relationship bucket from the resident's own ties: its parents and children are known to it; friends by affinity.
  tieBucket(c, id) { return c.parents.includes(id) || (c.children ?? []).includes(id) ? 'kin' : (c.relationships[id] ?? 0) > 0.3 ? 'friend' : 'other'; }
  // Whose home a shelter is, from this resident's own observations (mind.homes), excluding its own home.
  helpTarget(c, shelterId) {
    for (const [id, sid] of Object.entries(c.mind.homes ?? {})) if (sid === shelterId && Number(id) !== c.id) { const s = c.mind.shelters.find((q) => q.id === sid); if (s && (s.x !== c.home.x || s.y !== c.home.y)) return { id: Number(id), bucket: this.tieBucket(c, Number(id)) }; }
    return null;
  }
  nearestKnownShelter(c, ok = () => true) { let best = null, bd = Infinity; for (const s of c.mind.shelters ?? []) { if (s.complete === false || (s.integrity ?? 100) <= 0 || s.ruined || !ok(s)) continue; const d = Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)); if (d < bd) { bd = d; best = s; } } return best; }
  // Schema 4 affordances. Built only from this creature's observation and memory: perceived sites/shelters, its own
  // remembered (possibly stale) store contents and its inventory. No world lookup decides feasibility here.
  livingAffordances(c, obs, inv, prev, out, full, preparingMeal = false) {
    const held = (k) => (inv[k] ?? 0) > 0, cheb = (p) => Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y));
    // Construction: contribute to the nearest perceived unfinished site, or found one here.
    const site = obs.shelters.filter((s) => !s.complete).sort((a, b) => cheb(a) - cheb(b) || a.id - b.id)[0];
    if (site && c.energy >= 3) {
      const give = site.missing.filter(held);
      if (give.length || (!site.missing.length && site.work < site.workNeed)) out.push({ prim: 'build', site: site.id, x: site.x, y: site.y, key: modelKey('build', 'contribute', site.kind), consumes: give, label: 'BUILD' });
    }
    const S = STRUCTURES[obs.ambient.biome];
    // Founding is offered only away from other structures (spacing 4) and when this creature knows no standing shelter
    // within 10 tiles; otherwise it can use, stock or repair the shelters it knows.
    const housed = (c.mind.shelters ?? []).some((s) => s.complete !== false && (s.integrity ?? 100) > 0 && cheb(s) <= 10);
    if (!site && S && !housed && c.energy >= 4 && Object.keys(S.need).some(held) && !obs.shelters.some((s) => cheb(s) < 4)) {
      const watered = c.mind.water.some((w) => Math.abs(w.x - c.x) + Math.abs(w.y - c.y) <= 14);
      out.push({ prim: 'build', key: modelKey('build', 'found', `${S.kind}:${watered ? 'water' : 'dry'}`), consumes: Object.keys(S.need).filter(held), label: 'BUILD' });
    }
    // Repair a perceived worn shelter with one of its own building materials.
    // Repairing a shelter this resident has seen another resident live in is the voluntary "help" variant: its key
    // carries the relationship bucket, so whether helping pays is learned separately from repairing one's own home.
    for (const s of obs.shelters) if (s.complete && s.integrity < 70) {
      const it = Object.keys(STRUCTURES[this.biome(s.x, s.y)]?.need ?? {}).find(held);
      const helped = this.helpTarget(c, s.id);
      if (it && c.energy >= 2) { out.push({ prim: 'repair', shelter: s.id, x: s.x, y: s.y, item: it, ...(helped ? { help: helped.id } : {}), key: modelKey('repair', it, helped ? `help:${helped.bucket}` : s.kind), consumes: [it], label: 'BUILD' }); break; }
    }
    // Explicit nearby salvage of a perceived ruin (integrity 0). Its contents are unknown until tried.
    if (!full) for (const s of obs.shelters) if (s.ruined && cheb(s) <= 3 && c.energy >= 1) { out.push({ prim: 'salvage', shelter: s.id, x: s.x, y: s.y, key: modelKey('salvage', s.kind), label: 'GATHER_WOOD' }); break; }
    // Voluntary provisioning: a perceived hungry resident whose home this resident has seen, and food in hand.
    const food = Object.keys(inv).filter((k) => inv[k] > 0 && FOOD[k] && STORABLE.has(k)).sort()[0];
    if (food) for (const o of obs.creatures) {
      const hid = c.mind.homes?.[o.id]; if (!o.thin || hid === undefined) continue;
      const sh = c.mind.shelters.find((q) => q.id === hid && q.complete !== false && !q.ruined && (q.integrity ?? 100) > 0); if (!sh || cheb(sh) > 12) continue;
      const bucket = this.tieBucket(c, o.id);
      out.push({ prim: 'deposit', shelter: sh.id, x: sh.x, y: sh.y, item: food, help: o.id, key: modelKey('deposit', 'food', `help:${bucket}`), consumes: [food], label: 'SOCIALIZE' });
      break;
    }
    // Plant / tend / harvest. Offered from capabilities (a held item is "plantable"); soil, climate and water rules
    // are not consulted here, so where planting works is learned from outcomes.
    if (!prev && !obs.crops.some((q) => q.x === c.x && q.y === c.y) && !obs.shelters.some((s) => s.x === c.x && s.y === c.y)) for (const it of Object.keys(inv).filter((k) => inv[k] > 0 && cap(k, 'plantable')).sort().slice(0, 1))
      out.push({ prim: 'plant', item: it, key: modelKey('plant', it, `${obs.ambient.biome}:${obs.ambient.tile}`), consumes: [it], label: 'GATHER_WOOD' });
    const crop = obs.crops.filter((q) => !q.ripe).sort((a, b) => cheb(a) - cheb(b) || a.id - b.id)[0];
    if (crop && c.energy >= 1) out.push({ prim: 'tend', crop: crop.id, x: crop.x, y: crop.y, key: modelKey('tend', crop.kind, crop.dry ? 'dry' : 'wet'), label: 'GATHER_WOOD' });
    const ripe = obs.crops.filter((q) => q.ripe).sort((a, b) => cheb(a) - cheb(b) || a.id - b.id)[0];
    if (ripe && !full && c.energy >= 1) out.push({ prim: 'harvest', crop: ripe.id, x: ripe.x, y: ripe.y, kind: ripe.kind, key: modelKey('harvest', ripe.kind), label: 'EAT' });
    // Cooking: hold any "heatable" item over a perceived fire. What it turns into is learned, not shown.
    const fire = [...obs.fires, ...(c.mind.fires ?? []).filter((q) => !obs.fires.some((f) => f.id === q.id))].sort((a, b) => cheb(a) - cheb(b) || a.id - b.id)[0];
    if (fire && c.energy >= 1) for (const it of Object.keys(inv).filter((k) => inv[k] > 0 && cap(k, 'heatable')).sort().slice(0, 2))
      out.push({ prim: 'cook', item: it, fire: fire.id, x: fire.x, y: fire.y, key: modelKey('cook', it), consumes: [it], label: 'EAT' });
    // Shared stores at known shelters: deposit carried goods; retrieve what this creature last SAW stored.
    // Storage-aware: a store this resident last saw full is not offered for deposits.
    const home = this.nearestKnownShelter(c, (s) => !s.stock || sum(s.stock) < this.cfg.storeCapacity);
    if (home) {
      const goods = Object.keys(inv).filter((k) => inv[k] > 0 && STORABLE.has(k) && !(preparingMeal && (COOKING[k] || ['wood', 'flint', 'stone'].includes(k)))).sort((a, b) => inv[b] - inv[a] || (a < b ? -1 : 1)).slice(0, 2);
      for (const it of goods) out.push({ prim: 'deposit', shelter: home.id, x: home.x, y: home.y, item: it, key: modelKey('deposit', FOOD[it] ? 'food' : 'material'), consumes: Array(inv[it]).fill(it), label: 'GATHER_WOOD' });
    }
    if (!full) {
      // Materials are only fetched for a purpose the creature can see: a perceived unfinished site that lacks them,
      // or a perceived worn shelter. Food can always be fetched.
      const wanted = new Set([...(site?.missing ?? []), ...obs.shelters.filter((s) => s.complete && s.integrity < 70).flatMap((s) => Object.keys(STRUCTURES[this.biome(s.x, s.y)]?.need ?? {}))]);
      const stocked = this.nearestKnownShelter(c, (s) => s.stock && Object.entries(s.stock).some(([k, n]) => n > 0 && (FOOD[k] || wanted.has(k))));
      if (stocked) for (const it of Object.keys(stocked.stock).filter((k) => stocked.stock[k] > 0 && (FOOD[k] || wanted.has(k))).sort().slice(0, 2))
        out.push({ prim: 'retrieve', shelter: stocked.id, x: stocked.x, y: stocked.y, item: it, key: modelKey('retrieve', FOOD[it] ? 'food' : 'material'), label: FOOD[it] ? 'EAT' : 'GATHER_WOOD' });
    }
  }

  // ---------------- decision ----------------
  wellbeing(c) { return -(c.hunger + c.thirst) / 25 + Math.min(c.warmth, 80) / 25 + c.health / 20 + c.energy / 100; }
  decide(c) {
    const obs = this.perceive(c), f = this.features(c, obs), cues = this.cues(c, obs), demand = materialDemand(this, c, obs);
    if (trackSearch(this, c, obs, NODE_KINDS) === 'found') this.totals.replans.found = (this.totals.replans.found ?? 0) + 1;
    const goal = this.cfg.goals ? updateGoals(c, this.tick, this.danger(c)) : null;
    const mb = ensureMushroom(c.brain, this.seed, c.id), b = this.bounds();
    const trace = encode(mb, { features: f, cues, x: c.x - b.x0, y: c.y - b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
    const afford = this.affordances(c, obs, demand);
    let reflex = null;
    // Reflexes (designed, labelled source 'reflex'): escape fire; drink/eat when critical and a known source exists.
    if (this.fires.some((f2) => Math.max(Math.abs(f2.x - c.x), Math.abs(f2.y - c.y)) === 0)) reflex = [{ prim: 'move', purpose: 'escape', key: modelKey('move', 'escape'), label: 'FLEE' }];
    else if (c.thirst > 88 && c.mind.water.length) reflex = afford(c.inventory, null).filter((s) => s.key === modelKey('drink', 'known-fresh')).slice(0, 1);
    else if (c.hunger > 88) { const eat = afford(c.inventory, null).filter((s) => s.label === 'EAT' && s.prim !== 'use' || (s.prim === 'use' && s.on === 'self')); if (eat.length) reflex = [eat.find((s) => s.on === 'self') ?? eat[0]]; }
    if (reflex && !reflex.length) reflex = null;
    let chosen, cands;
    const P = this.cfg.planner, planning = this.mode !== 'no-planner';
    if (reflex) { chosen = { steps: reflex, preds: reflex.map((s) => predict(c.mind, s.key)), value: 0, source: 'reflex' }; this.totals.reflex++; }
    else {
      const seqs = plan(c.mind, { inventory: c.inventory }, afford, { ...P, bonus: P.bonus * (0.5 + c.personality.curiosity), enabled: planning, horizon: planning ? LIMITS.horizon : 1 });
      if (!seqs.length) seqs.push({ steps: [{ prim: 'rest', key: modelKey('rest', 'open'), label: 'REST' }], preds: [predict(c.mind, 'rest|open|')], value: 0 });
      const mbOn = this.mode !== 'none';
      cands = seqs.map((s) => {
        // The designed need bias is scaled by the creature's LEARNED success rate for that step once it has experience,
        // so a drive cannot keep pushing an action the creature has learned fails (e.g. fishing without a line).
        // Likewise the positive part of the label's innate drive is scaled by learned success after 3+ experiences, so a
        // hungry creature does not keep choosing a food action it has learned always fails.
        const p0 = s.preds[0], a = s.steps[0].label, conf = p0 && p0.n >= 3 ? Math.max(0.05, p0.success) : 1, base = innateUtility(a, f, c.personality);
        const innate = (base > 0 ? base * conf : base) + this.needBias(c, s.steps[0], demand) * (p0 && p0.n >= 1 ? p0.success : 1);
        const pref = mbOn ? readout(mb, a, trace, false) : 0;
        // Persistent goal: learned mean goal progress after this first step (goalModel), and avoidance of strategies
        // that repeatedly failed for this goal, so the resident switches to an alternative instead of looping.
        const gb = goal ? this.cfg.goalWeight * goal.urgency * goalBias(c.mind, goal, s.steps[0].key) : 0;
        return { a, u: innate + MB_PARAMS.gain * pref + (planning ? P.scale * s.value : 0) + gb, seq: s, innate, pref, gb };
      });
      const pick = pickMushroom(mb, cands, 0.35);
      chosen = { ...pick.seq, source: planning ? 'planner+mb-v1' : 'mb-v1', u: pick.u, innate: pick.innate, pref: pick.pref, gb: pick.gb };
      this.totals.planned++;
    }
    this.totals.decisions++; c.stats.decisions++;
    const pl = { id: this.nextId.plan++, tick: this.tick, source: chosen.source, steps: chosen.steps.map(describe), predicted: chosen.preds.map((p) => ({ reward: r3(p.reward), sigma: r3(p.sigma), success: r3(p.success), duration: r3(p.duration), n: r3(p.n) })),
      value: r3(chosen.value ?? 0), utility: r3(chosen.u ?? 0), mbPreference: r3(chosen.pref ?? 0), alternatives: cands ? cands.length : 0, actual: [], plannerVersion: PLANNER_VERSION, trace, raw: chosen.steps, idx: 0,
      goal: goal ? { id: goal.id, kind: goal.kind, urgency: goal.urgency, bias: r3(chosen.gb ?? 0), start: goalMetric(goal.kind, c), avoided: goal.avoid.slice() } : null };
    pl.demand = [...demand.keys()]; pl.fire = this.fireDemand(c, obs);
    c.plan = pl;
    // Decision evidence: actual needs, perception counts, demand, stocks and the best scored alternatives.
    const fs = foodStock(c, (k) => FOOD[k] !== undefined);
    recordDecision(c, { tick: this.tick, plan: pl.id, source: chosen.source, goal: goal?.kind ?? null, chosen: chosen.steps.map((s) => s.key), utility: r3(chosen.u ?? 0),
      alternatives: cands ? cands.filter((q) => q.seq !== pick0(cands, chosen)).sort((a, b) => b.u - a.u).slice(0, CHAIN_LIMITS.alternatives).map((q) => ({ key: q.seq.steps.map((s) => s.key).join(' > '), u: r3(q.u) })) : [],
      needs: { hunger: Math.round(c.hunger), thirst: Math.round(c.thirst), energy: Math.round(c.energy), warmth: Math.round(c.warmth), health: Math.round(c.health) },
      perceived: { nodes: obs.nodes.length, piles: obs.piles.length, shelters: obs.shelters.length, residents: obs.creatures.length, fires: obs.fires.length },
      demand: Object.fromEntries(demand), food: fs, search: c.mind.search ? { item: c.mind.search.item, found: !!c.mind.search.found } : null });
    this.startStep(c);
  }
  // Danger the resident itself perceives: standing in/next to fire, a recent attacker or threat in sight.
  danger(c) {
    const near = (x, y, r) => Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) <= r;
    const d = this.fires.some((f) => near(f.x, f.y, 0)) || [c.lastAttacker, c.threatenedBy].some((id) => { const o = id && this.getCreature(id); return o && near(o.x, o.y, 4); });
    if (d) c.lastDanger = this.tick;
    return d;
  }
  // Interruption by changed conditions (checked while a step runs): danger appears, or a critical need arises
  // that the current goal does not serve. The interrupted goal stays in the list and is resumed later.
  checkInterrupt(c) {
    if (!c.act || !this.cfg.goals) return false;
    const g = c.plan?.goal?.kind;
    if (this.danger(c) && g !== 'safety' && c.act.purpose !== 'escape' && c.act.purpose !== 'flee') { this.interrupt(c, 'danger'); return true; }
    if (c.thirst > 85 && g !== 'water' && c.act.prim !== 'use' && c.mind.water.length) { this.interrupt(c, 'thirst'); return true; }
    if (c.hunger > 85 && g !== 'food' && !['use', 'gather', 'harvest', 'retrieve', 'cook'].includes(c.act.prim)) { this.interrupt(c, 'hunger'); return true; }
    // Changed conditions: the repair target was fixed by someone else, the site finished, or a search found its resource.
    const a = c.act;
    if (a.prim === 'repair' && a.phase === 'travel') { const s = this.shelters.find((q) => q.id === a.shelter); if (s && s.integrity >= 95) { this.interrupt(c, 'repair-done'); return true; } }
    if (a.prim === 'build' && a.site !== undefined && a.phase === 'travel') { const s = this.shelters.find((q) => q.id === a.site); if (s?.complete) { this.interrupt(c, 'site-finished'); return true; } }
    if (a.prim === 'move' && a.purpose === 'search' && c.mind.search?.found) { this.interrupt(c, 'found'); return true; }
    return false;
  }
  // Designed homeostatic bias so drives are coupled to needs regardless of learning (documented heuristic).
  needBias(c, s, demand = null) {
    if (s.key.startsWith('drink|')) return c.thirst / 30 - 1;
    if (demand) {
      const item = s.prim === 'gather' ? NODE_KINDS[s.kind]?.item : s.item;
      if (s.prim === 'mend') return 0.4 + toolWearFrac(this, c, s.tool);
      if (s.prim === 'move' && s.purpose === 'search') return s.item === 'food' ? c.hunger / 40 - 0.6 : 0.35;
      if (s.prim === 'move' && s.purpose === 'home' && c.mind.search?.found) return 0.6;
      if (s.prim === 'carry' && s.haul) return demand.has(item) ? 0.45 : 0.1;
      if ((s.prim === 'gather' || s.prim === 'retrieve') && item && !FOOD[item] && STORABLE.has(item)) {
        if (demand.get(item)?.startsWith('prepare:fire')) return 0.65 + c.hunger / 90;
        if (demand.has(item)) return 0.35 + (1 - c.warmth / 100);
        if (c.warmth > 70 && !(s.prim === 'gather' && FUEL[item] && this.fireDemand(c, c.lastObs))) return -0.5; // surplus: no visible use
      }
      if (s.prim === 'build' || s.prim === 'repair') { const it = (s.consumes ?? []).find((k) => demand.has(k)); if (it) return 0.4 + (1 - c.warmth / 100); }
      if (s.prim === 'share' && FOOD[s.item]) { const o = c.lastObs?.creatures.find((q) => q.id === s.target); return o?.thin && c.hunger < 55 ? (s.item.startsWith('cooked_') ? 0.7 : 0.4) : c.hunger > 60 ? -0.4 : 0; }
      if (s.prim === 'place' && s.purpose === 'prepare-fire') return 0.7 + c.hunger / 90;
      if (s.prim === 'use' && s.on === 'pile' && s.purpose === 'prepare-fire') return 0.8 + c.hunger / 90;
      if (s.prim === 'cook' && c.hunger > 5) return 0.5 + c.hunger / 40; // cook before hunger becomes a raw-food reflex
      // Below the emergency threshold, a cookable meal is worth preserving while the resident is actively
      // seeking the visible inputs for preparation. At critical hunger the normal eat reflex remains available.
      if (s.prim === 'use' && s.on === 'self' && COOKING[s.item] && c.hunger < 75 && demand.get('wood')?.startsWith('prepare:fire')) return -1;
      if (s.prim === 'deposit' && !s.help && FOOD[s.item]) { const fs = foodStock(c, (k) => FOOD[k] !== undefined); if (c.hunger < 40 && fs.stored !== null && fs.stored < 6) return 0.3; }
    }
    if (s.prim === 'use' && s.on === 'self') return c.hunger / 30 - 1;
    if (s.prim === 'gather' && FOOD[NODE_KINDS[s.kind]?.item]) return c.hunger / 40 - 0.8;
    if (s.prim === 'rest') return (1 - c.energy / 100) * 2 + (s.key.includes('fire') || s.key.includes('shelter') ? (1 - c.warmth / 100) * 2 : 0) - 0.6;
    if (s.prim === 'retrieve' && FOOD[s.item]) return c.hunger / 35 - 0.9;
    if (s.prim === 'deposit' && s.help) return 0; // helping carries no designed drive; any preference for it is learned
    if (s.prim === 'deposit') return this.invWeight(c) / this.cfg.invCapacity * 1.2 - 0.5;
    if (s.prim === 'harvest' || s.prim === 'cook') return c.hunger / 45 - 0.8;
    if (s.prim === 'signal' || s.prim === 'plant' || s.prim === 'tend' || s.prim === 'salvage') return 0;
    if (s.label === 'GATHER_WOOD' || s.label === 'GATHER_STONE' || s.prim === 'build' || s.prim === 'repair') return (1 - c.warmth / 100) * 1.5 - 0.3;
    return 0;
  }
  startStep(c) {
    const p = c.plan, s = p?.raw[p.idx];
    if (!s) { this.finishPlan(c); return; }
    c.act = { ...s, started: this.tick, before: { wb: this.wellbeing(c), energy: c.energy, inv: { ...c.inventory }, ...(p.goal ? { gm: goalMetric(p.goal.kind, c) } : {}) }, work: 0, path: null };
    if (s.prim === 'move' && (s.purpose === 'explore' || s.purpose === 'search')) { const t = this.exploreTarget(c); c.act.x = t.x; c.act.y = t.y; }
    if (s.prim === 'move' && s.purpose === 'search') startSearch(this, c, s.item);
    if (s.prim === 'move' && s.purpose === 'escape') { const t = this.freeNeighbor(c, (x, y) => !this.fires.some((f) => f.x === x && f.y === y)); c.act.x = t?.x ?? c.x; c.act.y = t?.y ?? c.y; }
    if (s.prim === 'flee') { const o = this.getCreature(s.from); const dx = Math.sign(c.x - (o?.x ?? c.x)) || 1, dy = Math.sign(c.y - (o?.y ?? c.y)) || 1; c.act.x = c.x + dx * 6; c.act.y = c.y + dy * 6; c.act.prim = 'move'; c.act.purpose = 'flee'; c.act.wasFlee = true; }
  }
  exploreTarget(c) {
    // prefer a direction whose 8x8 cell has not been visited by this creature (own knowledge only)
    const b = this.bounds(); let best = null, bs = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = this.rng.next() * Math.PI * 2, d = 8 + this.rng.int(10), x = clamp(Math.round(c.x + Math.cos(a) * d), b.x0 + 1, b.x1 - 2), y = clamp(Math.round(c.y + Math.sin(a) * d), b.y0 + 1, b.y1 - 2);
      const s = (c.mind.visited.includes(`${x >> 3},${y >> 3}`) ? 0 : 1) + this.rng.next() * 0.5;
      if (s > bs) { bs = s; best = { x, y }; }
    }
    return best;
  }
  freeNeighbor(c, ok) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.passable(c.x + dx, c.y + dy) && ok(c.x + dx, c.y + dy)) return { x: c.x + dx, y: c.y + dy }; return null; }

  // ---------------- path finding (bounded A*, terrain costs) ----------------
  findPath(fx, fy, gx, gy, adj, limit = 2500) {
    const done = (x, y) => adj ? Math.max(Math.abs(x - gx), Math.abs(y - gy)) <= 1 : x === gx && y === gy;
    if (done(fx, fy)) return [];
    const key = (x, y) => (y + 4096) * 8192 + x + 4096;
    const g = new Map([[key(fx, fy), 0]]), prev = new Map(), heap = [[Math.max(Math.abs(gx - fx), Math.abs(gy - fy)), fx, fy]];
    let n = 0;
    while (heap.length && n++ < limit) {
      const [, x, y] = hpop(heap), kc = key(x, y), gc = g.get(kc);
      if (done(x, y)) { const path = []; let k = kc; while (k !== key(fx, fy)) { path.push([k % 8192 - 4096, Math.floor(k / 8192) - 4096]); k = prev.get(k); } return path.reverse(); }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy, mc = this.moveCost(nx, ny);
        if (mc === Infinity) continue;
        if (dx && dy && (!this.passable(x + dx, y) || !this.passable(x, y + dy))) continue;
        const ng = gc + mc * (dx && dy ? 1.4 : 1), kn = key(nx, ny);
        if (ng < (g.get(kn) ?? Infinity)) { g.set(kn, ng); prev.set(kn, kc); hpush(heap, [ng + Math.max(Math.abs(gx - nx), Math.abs(gy - ny)), nx, ny]); }
      }
    }
    return null;
  }

  // ---------------- step execution ----------------
  stepAct(c) {
    const a = c.act;
    const target = this.actTarget(c, a);
    if (target === false) return this.endStep(c, false, 'target-gone');
    if (target) {
      const reach = Math.max(Math.abs(target.x - c.x), Math.abs(target.y - c.y));
      const need = a.prim === 'move' || a.prim === 'place' || a.prim === 'carry' ? 0 : a.prim === 'threaten' ? 3 : 1;
      if (reach > need) {
        if (a.prim === 'move' && a.wasFlee && reach <= 0) return this.endStep(c, true);
        if (!a.path || a.retarget) { a.path = this.findPath(c.x, c.y, target.x, target.y, !['move', 'place', 'carry'].includes(a.prim)); a.retarget = false; if (!a.path) return this.endStep(c, false, 'no-path'); }
        if (this.tick - a.started > 400) return this.endStep(c, false, 'too-far');
        a.phase = 'travel';
        return this.walk(c, a);
      }
      if (a.prim === 'move') { if (a.purpose === 'respond') this.onRespond(c, a); return this.endStep(c, true); }
    }
    a.work++; a.phase = a.prim;
    return this.perform(c, a, target);
  }
  walk(c, a) {
    if (!a.path.length) { a.retarget = true; return; }
    const [nx, ny] = a.path[0], mc = this.moveCost(nx, ny);
    if (mc === Infinity) { a.retarget = true; a.blocked = (a.blocked ?? 0) + 1; if (a.blocked > 3) this.endStep(c, false, 'blocked'); return; }
    c.moveProgress = (c.moveProgress ?? 0) + 1;
    if (c.moveProgress < mc) return;
    // Heat exertion: walking in ambient heat above heatTemp costs 50% more energy (desert days).
    const cost = (0.08 * mc + 0.01 * this.invWeight(c)) * (this.ambient(c.x, c.y) > this.cfg.heatTemp ? 1.5 : 1);
    if (!this.spendEnergy(c, cost)) { c.moveProgress = 0; return this.endStep(c, false, 'exhausted'); }
    c.moveProgress = 0; a.path.shift();
    c.face = nx > c.x ? 1 : nx < c.x ? -1 : c.face; c.x = nx; c.y = ny; c.stats.moved++;
    if (c.stats.moved % 6 === 0) { const novel = markVisited(c.mind, c.x, c.y); if (novel) a.novel = (a.novel ?? 0) + 1; }
  }
  actTarget(c, a) {
    switch (a.prim) {
      case 'move': return { x: a.x, y: a.y };
      case 'place': case 'carry': if (a.x === undefined) return null; if (a.prim === 'carry' && !this.pileAt(a.x, a.y)) return false; return { x: a.x, y: a.y };
      case 'gather': case 'inspect': { const n = this.nodeAt(a.x, a.y); return n && n.id === a.node && !n.dead ? n : false; }
      case 'use': if (a.on === 'water') return { x: a.x, y: a.y }; if (a.on === 'fire') { const f = this.fires.find((q) => q.id === a.fire); return f ?? false; } return null;
      case 'deposit': case 'retrieve': case 'repair': return this.shelters.find((q) => q.id === a.shelter && q.complete !== false) ?? false;
      case 'build': if (a.site === undefined) return null; return this.shelters.find((q) => q.id === a.site) ?? false;
      case 'salvage': return this.shelters.find((q) => q.id === a.shelter && q.complete !== false) ?? false;
      case 'tend': case 'harvest': return this.crops.find((q) => q.id === a.crop) ?? false;
      case 'cook': return this.fires.find((q) => q.id === a.fire) ?? false;
      case 'share': case 'follow': case 'socialize': case 'threaten': case 'attack': { const o = this.getCreature(a.target); if (!o) return false; if (a.path && (Math.abs(o.x - a.lx) + Math.abs(o.y - a.ly) > 2)) a.retarget = true; a.lx = o.x; a.ly = o.y; return o; }
      default: return null;
    }
  }
  perform(c, a, target) {
    switch (a.prim) {
      case 'rest': {
        const shelter = !!this.shelterAt(c.x, c.y), fire = this.fireWarmth(c.x, c.y) > 0;
        c.energy = Math.min(100, c.energy + (shelter || fire ? 1.0 : 0.5)); if (c.injury) c.injury = Math.max(0, c.injury - 2);
        if (a.work >= 20 || c.energy >= 100) return this.endStep(c, true);
        return;
      }
      case 'inspect': { rememberNode(c.mind, target, this.tick); return this.endStep(c, true, null, { info: target.kind }); }
      case 'gather': {
        if (target.kind === 'fish') return this.performFish(c, a, target);
        const tool = !!c.inventory.hand_axe && TOOL_GATHER.has(target.kind);
        const dur = tool ? 3 : 6;
        if (a.work < dur) return;
        const item = NODE_KINDS[target.kind].item, units = Math.min(tool ? 2 : 1, target.units);
        const fits = Math.floor((this.cfg.invCapacity - this.invWeight(c)) / (WEIGHT[item] ?? 1)), q = Math.min(units, fits);
        if (q <= 0) return this.endStep(c, false, 'inventory-full');
        if (!this.spendEnergy(c, 1.2 * q)) return this.endStep(c, false, 'exhausted');
        target.units -= q; target.t = target.units + q >= NODE_KINDS[target.kind].max ? this.tick : target.t; this.dirty(target.x, target.y);
        this.addItem(c, item, q); this.totals.gathered[item] = (this.totals.gathered[item] ?? 0) + q; c.stats.gathered += q;
        if (tool) this.wearTool(c, 'hand_axe');
        rememberNode(c.mind, target, this.tick);
        if (NODE_KINDS[target.kind].blocks && target.units === 0) this.emit('node_depleted', { node: target.id });
        return this.endStep(c, true, null, { produced: { [item]: q } });
      }
      case 'combine': {
        if (a.work < 4) return;
        if (!c.inventory[a.a] || !c.inventory[a.b]) return this.endStep(c, false, 'missing-item');
        if (!this.spendEnergy(c, 1)) return this.endStep(c, false, 'exhausted');
        const out = RECIPES[`${a.a}+${a.b}`];
        if (!out) return this.endStep(c, false, 'no-result');
        this.takeItem(c, a.a); this.takeItem(c, a.b); this.addItem(c, out);
        for (const it of [a.a, a.b]) this.totals.craftUsed[it] = (this.totals.craftUsed[it] ?? 0) + 1;
        this.totals.crafted[out] = (this.totals.crafted[out] ?? 0) + 1;
        this.discover(c, `combine:${a.a}+${a.b}->${out}`);
        return this.endStep(c, true, null, { produced: { [out]: 1 } });
      }
      case 'place': {
        if (a.work < 2) return;
        if (!this.takeItem(c, a.item)) return this.endStep(c, false, 'missing-item');
        let p = this.pileAt(c.x, c.y);
        if (!p) { const ch = this.chunkAt(c.x, c.y); p = { id: `p${this.nextId.pile++}`, x: c.x, y: c.y, items: {} }; ch.piles.push(p); ch.pileAt.set(c.y * 100000 + c.x, p); }
        p.items[a.item] = (p.items[a.item] ?? 0) + 1; this.dirty(c.x, c.y); this.totals.placed[a.item] = (this.totals.placed[a.item] ?? 0) + 1;
        return this.endStep(c, true);
      }
      case 'carry': {
        const p = this.pileAt(c.x, c.y);
        if (!p || !p.items[a.item]) return this.endStep(c, false, 'nothing-there');
        if (this.invWeight(c) + (WEIGHT[a.item] ?? 1) > this.cfg.invCapacity) return this.endStep(c, false, 'inventory-full');
        p.items[a.item]--; if (!p.items[a.item]) delete p.items[a.item]; this.removePileIfEmpty(p); this.addItem(c, a.item); this.dirty(c.x, c.y);
        if (a.haul) this.totals.hauled[a.item] = (this.totals.hauled[a.item] ?? 0) + 1;
        // Picking a ground item up is a transfer, like retrieve/salvage: no material entered the world,
        // so it earns no acquisition reward and teaches observers nothing. The produced map is still
        // recorded in the outcome model so the planner keeps predicting the inventory change.
        return this.endStep(c, true, null, { transfer: true });
      }
      case 'mend': return this.performMend(c, a);
      case 'build': return this.performBuild(c, a, target);
      case 'repair': return this.performRepair(c, a, target);
      case 'deposit': return this.performDeposit(c, a, target);
      case 'retrieve': return this.performRetrieve(c, a, target);
      case 'salvage': return this.performSalvage(c, a, target);
      case 'plant': return this.performPlant(c, a);
      case 'tend': return this.performTend(c, a, target);
      case 'harvest': return this.performHarvest(c, a, target);
      case 'cook': return this.performCook(c, a, target);
      case 'signal': return this.performSignal(c, a);
      case 'use': return this.performUse(c, a, target);
      case 'share': {
        // The recipient has the same finite carrying capacity as anyone else; the giver keeps the item on refusal.
        if (this.invWeight(target) + (WEIGHT[a.item] ?? 1) > this.cfg.invCapacity) return this.endStep(c, false, 'inventory-full');
        if (!this.takeItem(c, a.item)) return this.endStep(c, false, 'missing-item');
        this.addItem(target, a.item);
        target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) + 0.25, -1, 1); c.relationships[target.id] = clamp((c.relationships[target.id] ?? 0) + 0.1, -1, 1);
        this.socialEvent('share', c, target, 'given'); c.stats.social++;
        return this.endStep(c, true, null, { social: 0.3 * c.personality.sociability + ((c.parents.includes(target.id) || target.parents?.includes(c.id)) ? 0.3 : 0) });
      }
      case 'socialize': {
        if (a.work < 8) return;
        c.relationships[target.id] = clamp((c.relationships[target.id] ?? 0) + 0.06, -1, 1); target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) + 0.04, -1, 1);
        c.stats.social++; return this.endStep(c, true, null, { social: 0.2 * c.personality.sociability });
      }
      case 'follow': {
        // The target decides: refusing is its own choice from its relationship to the follower (no assigned ruler).
        if ((target.relationships[c.id] ?? 0) < -0.15 || target.health < 30) { this.socialEvent('refuse', target, c, 'refused'); c.relationships[target.id] = clamp((c.relationships[target.id] ?? 0) - 0.1, -1, 1); return this.endStep(c, false, 'refused'); }
        c.following = { id: target.id, until: this.tick + 200 }; target.followers[c.id] = this.tick;
        this.socialEvent('follow', c, target, 'accepted');
        return this.endStep(c, true, null, { social: 0.1 });
      }
      case 'threaten': {
        if (!this.spendEnergy(c, 2)) return this.endStep(c, false, 'exhausted');
        const yields = target.personality.boldness * target.health < c.personality.boldness * c.health;
        target.threatenedBy = c.id; target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) - 0.2, -1, 1);
        this.socialEvent('threaten', c, target, yields ? 'target-yielded' : 'target-stood');
        if (yields && target.act?.prim === 'gather') { this.interrupt(target, 'threatened'); }
        return this.endStep(c, yields, yields ? null : 'stood-ground');
      }
      case 'attack': return this.performAttack(c, target);
    }
    return this.endStep(c, false, 'unknown');
  }
  performUse(c, a, target) {
    if (a.on === 'water') {
      if (a.work < 3) return;
      const t = this.tile(a.x, a.y);
      if (FRESH.has(t)) { c.thirst = Math.max(0, c.thirst - 45); rememberWater(c.mind, a.x, a.y, this.tick); return this.endStep(c, true, null, { drank: 'fresh' }); }
      if (SALT.has(t)) { c.thirst = Math.min(100, c.thirst + 8); c.health -= 2; return this.endStep(c, false, 'salt-water'); }
      return this.endStep(c, false, 'no-water');
    }
    if (a.work < 2) return;
    if (!c.inventory[a.item]) return this.endStep(c, false, 'missing-item');
    if (a.on === 'self') {
      const fd = FOOD[a.item]; if (!fd) { if (!this.spendEnergy(c, 0.5)) return this.endStep(c, false, 'exhausted'); return this.endStep(c, false, 'inedible'); }
      this.takeItem(c, a.item); this.totals.eaten[a.item] = (this.totals.eaten[a.item] ?? 0) + 1; c.stats.eaten++;
      const rev = this.cfg.rewardReversal;
      if (rev && rev.item === a.item && this.tick >= rev.fromTick) { c.hunger = Math.max(0, c.hunger - 4); c.health -= 10; return this.endStep(c, true, null, { toxic: true }); }
      c.hunger = Math.max(0, c.hunger - fd.hunger); if (fd.thirst) c.thirst = Math.max(0, c.thirst - fd.thirst);
      return this.endStep(c, true);
    }
    if (a.on === 'pile') {
      const p = this.pileAt(c.x, c.y);
      if (!p) return this.endStep(c, false, 'no-pile');
      if (!this.spendEnergy(c, 1.5)) return this.endStep(c, false, 'exhausted');
      // Ignition rule: striking flint on stone is reliable; an ordinary sharp stone can also make a weaker spark.
      const flintStrike = a.item === 'flint' && c.inventory.stone;
      const stoneStrike = a.item === 'stone' && (c.inventory.stone ?? 0) >= 1;
      if (!flintStrike && !stoneStrike) return this.endStep(c, false, 'no-ignition');
      const fuel = Object.entries(p.items).reduce((s, [k, n]) => s + (FUEL[k] ?? 0) * n, 0);
      if (fuel <= 0) return this.endStep(c, false, 'no-fuel');
      const wet = this.weather.rain || [T.SNOW, T.SHALLOW].includes(this.tile(c.x, c.y));
      const spark = flintStrike ? 0.6 : 0.35;
      const pIgnite = clamp((spark + (p.items.fiber || p.items.bundle ? 0.35 : 0)) * (wet ? 0.25 : 1) * (this.biome(c.x, c.y) === 'arid' ? 1.3 : 1), 0, 0.95);
      if (this.rng.next() >= pIgnite) return this.endStep(c, false, 'no-spark-caught');
      for (const [k, n] of Object.entries(p.items)) if (FUEL[k]) { this.totals.burnedItems[k] = (this.totals.burnedItems[k] ?? 0) + n; delete p.items[k]; }
      this.removePileIfEmpty(p);
      this.fires.push({ id: this.nextId.fire++, x: c.x, y: c.y, fuel, lit: this.tick, by: c.id });
      this.discover(c, 'fire:strike-flint-on-fuel');
      this.emit('fire_lit', { by: c.id, x: c.x, y: c.y, fuel });
      return this.endStep(c, true, null, { fire: true });
    }
    if (a.on === 'fire') {
      const f = target;
      if (!this.spendEnergy(c, 1)) return this.endStep(c, false, 'exhausted');
      this.takeItem(c, a.item);
      if (FUEL[a.item]) { f.fuel += FUEL[a.item]; this.totals.burnedItems[a.item] = (this.totals.burnedItems[a.item] ?? 0) + 1; return this.endStep(c, true, null, { fed: true }); }
      // anything non-flammable smothers (sand/stone/soil-like)
      this.dropToPile(f.x, f.y, a.item); f.fuel -= 8; if (f.fuel <= 0) this.extinguish(f, 'smothered');
      return this.endStep(c, true, null, { smothered: true });
    }
    return this.endStep(c, false, 'no-effect');
  }
  // ---------------- schema 4: fishing, construction, repair, shared stores ----------------
  // Fishing: needs a fish stock reachable from the shore (reach 1), a held fish_line, 12 ticks (cast, wait, reel)
  // and 1.5 energy. Each attempt wears the line; a bite is probabilistic and likelier when the stock is fuller.
  performFish(c, a, n) {
    if (!c.inventory.fish_line) {
      a.phase = 'inspect';
      if (a.work < 3) return;
      this.spendEnergy(c, 0.3);
      return this.endStep(c, false, 'needs-fishing-line');
    }
    a.phase = a.work <= 4 ? 'cast' : a.work <= 9 ? 'wait' : 'reel';
    if (a.work < 12) return;
    if (this.invWeight(c) + 1 > this.cfg.invCapacity) return this.endStep(c, false, 'inventory-full');
    if (!this.spendEnergy(c, 1.5)) return this.endStep(c, false, 'exhausted');
    c.toolWear.fish_line = (c.toolWear.fish_line ?? 0) + 1;
    if (c.toolWear.fish_line >= TOOLS.fish_line.uses) { this.takeItem(c, 'fish_line'); c.toolWear.fish_line = 0; this.totals.wornOut.fish_line = (this.totals.wornOut.fish_line ?? 0) + 1; this.emit('tool_worn', { by: c.id, tool: 'fish_line' }); }
    rememberNode(c.mind, n, this.tick);
    if (n.units <= 0) return this.endStep(c, false, 'no-fish');
    const bite = this.cfg.fishBite * (0.4 + 0.6 * n.units / NODE_KINDS.fish.max) * (this.weather.rain ? 1.15 : 1);
    if (this.rng.next() >= bite) return this.endStep(c, false, 'no-bite');
    n.t = n.units >= NODE_KINDS.fish.max ? this.tick : n.t; n.units -= 1; this.dirty(n.x, n.y);
    this.addItem(c, 'fish'); this.totals.gathered.fish = (this.totals.gathered.fish ?? 0) + 1; c.stats.gathered++;
    rememberNode(c.mind, n, this.tick);
    if (n.units === 0) this.emit('fish_depleted', { node: n.id, x: n.x, y: n.y });
    return this.endStep(c, true, null, { produced: { fish: 1 } });
  }
  newStructure(x, y, builder) {
    const biome = this.biome(x, y), S = STRUCTURES[biome];
    return { id: this.nextId.shelter++, x, y, cap: 4, kind: S.kind, biome, stage: 0, complete: false, materials: {}, need: { ...S.need }, work: 0, workNeed: S.work, integrity: 100, store: {}, builder, tick: this.tick };
  }
  // Founding marks a site (4 ticks); contributing delivers one needed held material every 3 ticks and adds labour
  // only up to the share of materials already delivered. Stage 0..2 reflects min(materials, labour); 3 = finished.
  performBuild(c, a, s) {
    if (!s) {
      a.phase = 'mark';
      if (a.work < 4) return;
      const t = this.tile(c.x, c.y);
      if (t === T.STREAM || t === T.SHALLOW || this.shelters.some((o) => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) < 4) || this.fires.some((f) => f.x === c.x && f.y === c.y)) return this.endStep(c, false, 'cannot-build');
      if (!this.spendEnergy(c, 1)) return this.endStep(c, false, 'exhausted');
      s = this.newStructure(c.x, c.y, c.id); this.shelters.push(s); a.site = s.id; a.founded = true;
      this.emit('site_founded', { shelter: s.id, by: c.id, x: s.x, y: s.y, kind: s.kind, biome: s.biome });
      return;
    }
    if (s.complete) return this.endStep(c, !!(a.delivered || a.worked), a.delivered || a.worked ? null : 'already-complete', { progress: a.gain ?? 0 });
    const missing = missingMaterials(s), give = missing.find((k) => (c.inventory[k] ?? 0) > 0);
    const needTotal = sum(s.need), cap = Math.floor(s.workNeed * sum(s.materials) / needTotal);
    if (give && a.work % 3 === 0) {
      if (!this.spendEnergy(c, 0.5)) return this.endStep(c, false, 'exhausted');
      this.takeItem(c, give); s.materials[give] = (s.materials[give] ?? 0) + 1; this.totals.built[give] = (this.totals.built[give] ?? 0) + 1;
      a.delivered = (a.delivered ?? 0) + 1; a.gain = (a.gain ?? 0) + 1 / needTotal; a.phase = 'deliver';
    } else if (s.work < cap) {
      if (!this.spendEnergy(c, 0.15)) return this.endStep(c, false, 'exhausted');
      s.work++; a.worked = (a.worked ?? 0) + 1; a.gain = (a.gain ?? 0) + 0.5 / s.workNeed; a.phase = 'construct';
    } else if (!give) {
      a.phase = 'idle';
      return this.endStep(c, !!(a.delivered || a.worked), a.delivered || a.worked ? null : 'missing-materials', { progress: a.gain ?? 0 });
    } else { a.phase = 'deliver'; return; }
    s.stage = Math.min(2, Math.floor(3 * Math.min(sum(s.materials) / needTotal, s.work / s.workNeed)));
    if (!missingMaterials(s).length && s.work >= s.workNeed) {
      s.complete = true; s.stage = 3; s.integrity = 100; s.done = this.tick;
      settledSearch(this, c, s);
      rememberShelter(c.mind, s, this.tick, true); c.home = { x: s.x, y: s.y }; c.stats.built++;
      const far = Math.hypot(s.x - BASE / 2, s.y - BASE / 2) > 40;
      this.emit('shelter_built', { shelter: s.id, by: c.id, x: s.x, y: s.y, kind: s.kind, biome: this.biome(s.x, s.y), newSettlement: far });
      if (far && !this.shelters.some((o) => o !== s && o.complete !== false && Math.hypot(o.x - s.x, o.y - s.y) < 15)) this.discover(c, `settlement:${s.x >> 4},${s.y >> 4}`);
      return this.endStep(c, true, null, { progress: a.gain, completed: true });
    }
    this.dirty(s.x, s.y);
    if (a.work >= 60) return this.endStep(c, true, null, { progress: a.gain ?? 0 });
  }
  // Tool upkeep (designed rule): 5 ticks, 1 energy and one unit of the tool's material restore half its wear.
  performMend(c, a) {
    a.phase = 'mend';
    if (a.work < 5) return;
    const rule = MEND[a.tool];
    if (!rule || !c.inventory[a.tool] || !c.inventory[rule.item]) return this.endStep(c, false, 'missing-item');
    if (!(c.toolWear[a.tool] > 0)) return this.endStep(c, false, 'not-needed');
    if (!this.spendEnergy(c, 1)) return this.endStep(c, false, 'exhausted');
    this.takeItem(c, rule.item); this.totals.mendUsed[rule.item] = (this.totals.mendUsed[rule.item] ?? 0) + 1; this.totals.mended[a.tool] = (this.totals.mended[a.tool] ?? 0) + 1;
    const before = c.toolWear[a.tool]; c.toolWear[a.tool] = Math.floor(before * (1 - rule.restore));
    return this.endStep(c, true, null, { progress: (before - c.toolWear[a.tool]) / (TOOLS[a.tool]?.uses ?? 1) });
  }
  performRepair(c, a, s) {
    a.phase = 'repair';
    if (a.work < 6) return;
    if (s.integrity >= 95) return this.endStep(c, false, 'not-needed');
    if (!c.inventory[a.item] || !(a.item in (STRUCTURES[this.biome(s.x, s.y)]?.need ?? {}))) return this.endStep(c, false, 'wrong-material');
    if (!this.spendEnergy(c, 1)) return this.endStep(c, false, 'exhausted');
    this.takeItem(c, a.item); this.totals.repaired[a.item] = (this.totals.repaired[a.item] ?? 0) + 1;
    const before = s.integrity; s.integrity = Math.min(100, s.integrity + this.cfg.repairAmount);
    if (before <= 0) this.emit('shelter_restored', { shelter: s.id, by: c.id });
    rememberShelter(c.mind, s, this.tick, true);
    if (a.help !== undefined) { this.totals.helped.repair = (this.totals.helped.repair ?? 0) + 1; const o = this.getCreature(a.help); if (o) this.socialEvent('help', c, o, `repaired:${s.id}`); }
    return this.endStep(c, true, null, { progress: (s.integrity - before) / 100 });
  }
  performDeposit(c, a, s) {
    a.phase = 'store';
    if (a.work < 2) return;
    const have = c.inventory[a.item] ?? 0, space = this.cfg.storeCapacity - sum(s.store), q = Math.min(have, space);
    rememberShelter(c.mind, s, this.tick, true);
    // A ruin (integrity 0) is not a working store: contents stay as they are until it is repaired or salvaged.
    if (s.integrity <= 0) return this.endStep(c, false, 'ruined');
    if (!have) return this.endStep(c, false, 'missing-item');
    if (q <= 0) return this.endStep(c, false, 'store-full');
    this.takeItem(c, a.item, q); s.store[a.item] = (s.store[a.item] ?? 0) + q; this.totals.deposited[a.item] = (this.totals.deposited[a.item] ?? 0) + q;
    rememberShelter(c.mind, s, this.tick, true);
    if (a.help !== undefined) { this.totals.helped.provision = (this.totals.helped.provision ?? 0) + q; this.socialEvent('help', c, this.getCreature(a.help), `provisioned:${a.item}x${q}`); }
    // Provision drive (designed): only goods this creature did not itself take out of a store count, so moving the
    // same goods in and out of stores earns nothing.
    const recycled = Math.min(q, c.fromStore[a.item] ?? 0), fresh = q - recycled;
    if (recycled) { c.fromStore[a.item] -= recycled; if (!c.fromStore[a.item]) delete c.fromStore[a.item]; }
    const own = c.home.x === s.x && c.home.y === s.y;
    return this.endStep(c, true, null, { provision: (own ? 0.03 : 0.015) * fresh });
  }
  performRetrieve(c, a, s) {
    a.phase = 'store';
    if (a.work < 2) return;
    rememberShelter(c.mind, s, this.tick, true); // sees the actual store now; a stale memory is corrected
    if (s.integrity <= 0) return this.endStep(c, false, 'ruined');
    const avail = s.store[a.item] ?? 0;
    if (!avail) return this.endStep(c, false, 'store-empty');
    const q = Math.min(avail, 3, Math.floor((this.cfg.invCapacity - this.invWeight(c)) / (WEIGHT[a.item] ?? 1)));
    if (q <= 0) return this.endStep(c, false, 'inventory-full');
    s.store[a.item] -= q; if (!s.store[a.item]) delete s.store[a.item]; this.addItem(c, a.item, q); c.fromStore[a.item] = (c.fromStore[a.item] ?? 0) + q;
    this.totals.retrieved[a.item] = (this.totals.retrieved[a.item] ?? 0) + q;
    rememberShelter(c.mind, s, this.tick, true);
    return this.endStep(c, true, null, { transfer: true });
  }
  // Salvage (explicit, nearby, ruins only): takes up to 3 stored units out of a ruined shelter's preserved store.
  performSalvage(c, a, s) {
    a.phase = 'salvage';
    if (a.work < 4) return;
    rememberShelter(c.mind, s, this.tick, true);
    if (s.integrity > 0) return this.endStep(c, false, 'not-ruined');
    const it = Object.keys(s.store).filter((k) => s.store[k] > 0).sort()[0];
    if (!it) return this.endStep(c, false, 'nothing-left');
    const q = Math.min(s.store[it], 3, Math.floor((this.cfg.invCapacity - this.invWeight(c)) / (WEIGHT[it] ?? 1)));
    if (q <= 0) return this.endStep(c, false, 'inventory-full');
    if (!this.spendEnergy(c, 0.6)) return this.endStep(c, false, 'exhausted');
    s.store[it] -= q; if (!s.store[it]) delete s.store[it]; this.addItem(c, it, q); c.fromStore[it] = (c.fromStore[it] ?? 0) + q;
    this.totals.salvaged[it] = (this.totals.salvaged[it] ?? 0) + q;
    rememberShelter(c.mind, s, this.tick, true);
    this.emit('ruin_salvaged', { shelter: s.id, by: c.id, item: it, units: q });
    return this.endStep(c, true, null, { transfer: true });
  }
  // ---------------- schema 5: crops (plant / tend / harvest) ----------------
  performPlant(c, a) {
    a.phase = 'plant';
    if (a.work < CROP.plantTicks) return;
    if (!c.inventory[a.item]) return this.endStep(c, false, 'missing-item');
    if (!this.spendEnergy(c, CROP.plantEnergy)) return this.endStep(c, false, 'exhausted');
    const rule = CROPS[a.item], t = this.tile(c.x, c.y);
    // Seed is kept when the ground cannot take it (no hidden loss); outcome reason is all the resident learns.
    if (!rule) return this.endStep(c, false, 'does-not-take');
    if (!rule.soil.includes(t) || this.nodeAt(c.x, c.y) || this.crops.some((q) => q.x === c.x && q.y === c.y) || this.shelters.some((s) => s.x === c.x && s.y === c.y) || this.fires.some((q) => q.x === c.x && q.y === c.y)) return this.endStep(c, false, 'barren-ground');
    if (this.crops.length >= CROP.maxCrops) return this.endStep(c, false, 'barren-ground');
    this.takeItem(c, a.item); this.totals.planted[a.item] = (this.totals.planted[a.item] ?? 0) + 1;
    const crop = { id: this.nextId.crop++, x: c.x, y: c.y, kind: a.item, by: c.id, planted: this.tick, growth: 0, moisture: this.naturalWater(c.x, c.y) ? CROP.moistureMax : 2, stress: 0, ripe: false, tended: 0 };
    this.crops.push(crop);
    this.emit('crop_planted', { crop: crop.id, by: c.id, x: c.x, y: c.y, kind: a.item });
    return this.endStep(c, true, null, { planted: true });
  }
  // Fresh water within reach of a tile (designed: soil next to a lake or stream stays moist).
  naturalWater(x, y, r = CROP.naturalWaterReach) { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (FRESH.has(this.tile(x + dx, y + dy))) return true; return false; }
  performTend(c, a, q) {
    a.phase = 'tend';
    if (a.work < CROP.tendTicks) return;
    if (!this.spendEnergy(c, CROP.tendEnergy)) return this.endStep(c, false, 'exhausted');
    if (q.ripe) return this.endStep(c, false, 'not-needed');
    // Watering needs fresh water near the crop (carried by hand over a few tiles); otherwise the soil stays dry.
    if (!this.naturalWater(q.x, q.y, CROP.tendWaterReach)) return this.endStep(c, false, 'no-water-near');
    const before = q.moisture; q.moisture = Math.min(CROP.moistureMax, q.moisture + CROP.tendGain); q.tended++;
    if (q.by !== c.id) this.totals.helped.tend = (this.totals.helped.tend ?? 0) + 1; // tending someone else's crop
    return this.endStep(c, q.moisture > before, q.moisture > before ? null : 'already-wet');
  }
  performHarvest(c, a, q) {
    a.phase = 'harvest';
    if (a.work < CROP.harvestTicks) return;
    if (!q.ripe) return this.endStep(c, false, 'not-ripe');
    const rule = CROPS[q.kind], fits = Math.floor((this.cfg.invCapacity - this.invWeight(c)) / (WEIGHT[q.kind] ?? 1)), n = Math.min(rule.yield, fits);
    if (n <= 0) return this.endStep(c, false, 'inventory-full');
    if (!this.spendEnergy(c, CROP.harvestEnergy)) return this.endStep(c, false, 'exhausted');
    // Anything that does not fit stays on the ground as a pile: the full yield always enters the world.
    this.addItem(c, q.kind, n); if (rule.yield > n) this.dropToPile(q.x, q.y, q.kind, rule.yield - n);
    this.totals.harvested[q.kind] = (this.totals.harvested[q.kind] ?? 0) + rule.yield; c.stats.gathered += n;
    this.crops.splice(this.crops.indexOf(q), 1);
    this.emit('crop_harvested', { crop: q.id, by: c.id, planter: q.by, kind: q.kind, units: rule.yield });
    return this.endStep(c, true, null, { produced: { [q.kind]: n } });
  }
  stepCrops() {
    for (const q of this.crops.slice()) {
      if (q.ripe) continue;
      if (this.weather.rain || this.naturalWater(q.x, q.y)) q.moisture = CROP.moistureMax; else q.moisture = Math.max(0, q.moisture - 1);
      const rule = CROPS[q.kind], temp = cropTemp(this.biome(q.x, q.y), this.tile(q.x, q.y));
      if (q.moisture > 0 && temp >= rule.minTemp && temp <= rule.maxTemp) { q.growth++; q.stress = 0; if (q.growth >= rule.grow) { q.ripe = true; this.emit('crop_ripe', { crop: q.id, x: q.x, y: q.y }); } }
      else if (++q.stress >= rule.withers) { this.crops.splice(this.crops.indexOf(q), 1); this.totals.withered[q.kind] = (this.totals.withered[q.kind] ?? 0) + 1; this.emit('crop_withered', { crop: q.id, x: q.x, y: q.y, cause: q.moisture > 0 ? 'climate' : 'dry' }); }
    }
  }
  // ---------------- schema 5: cooking ----------------
  // Holding a heatable item over a lit fire for COOK.ticks. Fish/shellfish/lichen become their cooked form 1:1
  // (conserved), the fire loses COOK.heat fuel. Other heatable items scorch: kept unchanged, heat still spent.
  performCook(c, a, f) {
    a.phase = 'cook';
    if (a.work < COOK.ticks) return;
    if (!c.inventory[a.item]) return this.endStep(c, false, 'missing-item');
    if (f.fuel < COOK.minFuel) return this.endStep(c, false, 'fire-too-low');
    if (!this.spendEnergy(c, COOK.energy)) return this.endStep(c, false, 'exhausted');
    f.fuel -= COOK.heat; this.totals.heatUsed = r3((this.totals.heatUsed ?? 0) + COOK.heat);
    const out = COOKING[a.item];
    if (f.fuel <= 0) this.extinguish(f, 'fuel');
    if (!out) return this.endStep(c, false, 'scorched');
    this.takeItem(c, a.item); this.addItem(c, out);
    this.totals.cookedIn[a.item] = (this.totals.cookedIn[a.item] ?? 0) + 1; this.totals.cookedOut[out] = (this.totals.cookedOut[out] ?? 0) + 1;
    this.discover(c, `cook:${a.item}->${out}`);
    return this.endStep(c, true, null, { produced: { [out]: 1 } });
  }
  // ---------------- schema 5: limited learned signalling ----------------
  performSignal(c, a) {
    a.phase = 'signal';
    if (!this.spendEnergy(c, 0.05)) return this.endStep(c, false, 'exhausted');
    const sig = { id: this.nextId.signal++, tick: this.tick, from: c.id, glyph: a.glyph, ctx: a.ctx, x: c.x, y: c.y, receivers: [], misheard: 0 };
    for (const o of this.creaturesNear(c.x, c.y, SIGNAL.range)) {
      if (o === c) continue;
      const got = perceiveSignal(this.rng, c, o, a.glyph, Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)), sig);
      if (got) { sig.receivers.push(o.id); if (got.mis) sig.misheard++; }
    }
    this.signals.push(sig); if (this.signals.length > SIGNAL.ring) this.signals.shift();
    this.totals.signals++; this.totals.signalsHeard += sig.receivers.length; this.totals.signalsMisheard += sig.misheard;
    c.signalCooldown = this.tick + SIGNAL.cooldown;
    c.mind.sent.push({ sig: sig.id, glyph: a.glyph, ctx: a.ctx, tick: this.tick, heardBy: sig.receivers.length, credit: 0 });
    if (c.mind.sent.length > 6) c.mind.sent.shift();
    // No intrinsic reward for signalling: the step's reward is only its (small) cost. Any learned value comes later
    // from responders' realised need gains (see settleWatch), capped and only for that one signal.
    return this.endStep(c, true, null, { signal: true });
  }
  // Responding = walking to where a glyph was heard. On arrival the resident notes what IT perceives there.
  onRespond(c, a) {
    const obs = this.perceive(c), cat = salientCategory(obs, c), m = c.mind, as = association(m, a.glyph), learn = this.learning && this.mode !== 'frozen';
    as.responded++; if (learn) noteCooccurrence(as, [cat]);
    c.signalWatch = { sig: a.sig, glyph: a.glyph, from: a.from, until: this.tick + SIGNAL.watch, wb: this.wellbeing(c), key: a.key, cat };
    this.totals.responses++;
  }
  // After the watch window the receiver compares its own wellbeing with arrival and learns the payoff of responding
  // to that glyph from that sender (association payoff, outcome model `respond|glyph|trust`, trust in sender).
  settleWatch(c) {
    const w = c.signalWatch; c.signalWatch = null;
    const gain = clamp(this.wellbeing(c) - w.wb, -2, 2), as = association(c.mind, w.glyph), learn = this.learning && this.mode !== 'frozen';
    // Only the receiver learns from the outcome it realised: its own association payoff, outcome model and
    // trust. In frozen mode none of these learned structures move (heard/responded stay perception counters).
    if (learn) {
      as.n++; as.payoff = r3(as.payoff + (gain - as.payoff) / as.n);
      updateModel(c.mind, w.key, { tick: this.tick, success: gain > 0.1, reward: gain, duration: SIGNAL.watch, energy: 0, produced: {} });
      updateTrust(c, w.from, gain > 0.1);
    }
    const s = this.signals.find((q) => q.id === w.sig);
    if (s) { s.outcomes ??= []; s.outcomes.push({ by: c.id, gain: r3(gain) }); if (s.outcomes.length > 6) s.outcomes.shift(); }
    // Sender credit is not global knowledge: the receiver's realised gain is private. When the response paid
    // off and the responder has a positive tie back, it emits a bounded acknowledgement (the glyph it
    // responded to) that reaches the sender only if the sender is still within signal range AND attends to
    // it - the same distance, attention and misperception rules as any signal. A sender that walked away or
    // did not notice learns nothing; a misheard acknowledgement can credit a different glyph than the one sent.
    const snd = this.getCreature(w.from);
    if (learn && snd && s && gain > 0.1 && (snd.relationships[c.id] ?? 0) > 0) {
      const dist = Math.max(Math.abs(c.x - snd.x), Math.abs(c.y - snd.y));
      if (dist <= SIGNAL.range) {
        const fb = { id: this.nextId.signal++, tick: this.tick, from: c.id, glyph: w.glyph, ctx: 'ack', x: c.x, y: c.y, receivers: [], misheard: 0, for: s.id };
        const got = perceiveSignal(this.rng, c, snd, w.glyph, dist, fb);
        if (got) { fb.receivers.push(snd.id); if (got.mis) fb.misheard++; }
        this.signals.push(fb); if (this.signals.length > SIGNAL.ring) this.signals.shift();
        this.totals.signalsFeedback = (this.totals.signalsFeedback ?? 0) + 1;
        this.totals.signalsHeard += fb.receivers.length; this.totals.signalsMisheard += fb.misheard;
        if (got) {
          // Attribution is by the glyph heard back, matched against the sender's own bounded sent history:
          // the most recent matching emission is credited. A forgotten or mismatched send earns nothing.
          const rec = snd.mind.sent.slice().reverse().find((q) => q.glyph === got.heard);
          if (rec) {
            const credit = Math.min(SIGNAL.creditCap, SIGNAL.credit * gain * (0.5 + snd.personality.sociability * 0.5) * got.conf);
            updateModel(snd.mind, modelKey('signal', got.heard, rec.ctx ?? ''), { tick: this.tick, success: true, reward: credit, duration: 1, energy: 0.05, produced: {} }, 0.5);
            rec.credit = r3(rec.credit + credit); rec.acknowledged = this.tick;
            this.totals.signalCredit = r3((this.totals.signalCredit ?? 0) + credit);
          }
        }
      }
    }
  }
  stepShelters() {
    const k = this.cfg.decayEvery;
    for (const s of this.shelters) {
      if (s.complete === false || s.integrity <= 0) continue;
      const d = (STRUCTURES[s.biome ?? this.biome(s.x, s.y)]?.decay ?? 0.005) * k * (this.weather.rain ? 1.5 : 1);
      s.integrity = Math.max(0, Math.round((s.integrity - d) * 1000) / 1000);
      if (s.integrity <= 0) this.emit('shelter_ruined', { shelter: s.id, x: s.x, y: s.y });
    }
  }
  // Truthful render state: derived only from the engine's current step, its phase and the inventory.
  activity(c) {
    const a = c.act, load = this.invWeight(c);
    const carrying = Object.fromEntries(Object.entries(c.inventory).filter(([k, n]) => n > 0 && STORABLE.has(k)));
    const tools = Object.keys(c.inventory).filter((k) => c.inventory[k] > 0 && (TOOLS[k] || k === 'hand_axe' || k === 'stone_club'));
    if (!a) return { state: c.following ? 'follow' : 'idle', prim: null, phase: null, progress: 0, target: null, item: null, load, capacity: this.cfg.invCapacity, carrying, tools };
    const night = this.daylight() < -0.3;
    let state = { gather: a.kind === 'fish' ? 'fish' : 'gather', rest: night ? 'sleep' : 'rest', build: 'construct', repair: 'repair', deposit: 'store', retrieve: 'store', combine: 'craft', place: 'place', carry: 'gather', inspect: 'inspect', share: 'social', socialize: 'social', follow: 'social', threaten: 'social', attack: 'fight', move: 'travel', plant: 'plant', tend: 'tend', harvest: 'harvest', cook: 'cook', salvage: 'salvage', signal: 'signal', mend: 'mend' }[a.prim] ?? a.prim;
    if (a.prim === 'carry' && a.haul) state = 'haul';
    if (a.prim === 'use') state = a.on === 'water' ? 'drink' : a.on === 'self' ? 'eat' : a.on === 'fire' ? 'tend-fire' : 'make-fire';
    // `starting` = step chosen, no movement or work yet. This is checked for every primitive, including build, so a
    // newly chosen build step never reports `idle` (schema-4 defect). Build keeps `construct` only for real
    // marking/delivery/labour phases.
    if (a.phase === 'travel') state = 'travel';
    else if (!a.phase) state = 'starting';
    else if (a.prim === 'gather' && a.kind === 'fish' && a.phase === 'inspect') state = 'inspect'; // no line: looks, never casts
    else if (a.prim === 'build' && !['deliver', 'construct', 'mark'].includes(a.phase)) state = 'starting';
    if (a.prim === 'move' && a.purpose === 'respond' && state === 'travel') state = 'respond';
    if (a.prim === 'move' && a.purpose === 'search' && state === 'travel') state = 'search';
    if (a.prim === 'move' && a.purpose === 'home' && c.mind.search?.found && state === 'travel') state = 'return';
    const dur = { rest: 20, inspect: 1, combine: 4, place: 2, repair: 6, deposit: 2, retrieve: 2, socialize: 8, salvage: 4, mend: 5, plant: CROP.plantTicks, tend: CROP.tendTicks, harvest: CROP.harvestTicks, cook: COOK.ticks, signal: 1, use: a.on === 'water' ? 3 : 2 }[a.prim] ?? (a.prim === 'gather' ? (a.kind === 'fish' ? 12 : c.inventory.hand_axe && TOOL_GATHER.has(a.kind) ? 3 : 6) : 1);
    let progress = a.phase === 'travel' || !a.phase ? 0 : Math.min(1, a.work / dur);
    if (a.prim === 'build' && a.site !== undefined) { const s = this.shelters.find((q) => q.id === a.site); if (s) progress = s.complete ? 1 : Math.round(100 * (sum(s.materials) / sum(s.need) + s.work / s.workNeed) / 2) / 100; }
    return { state, prim: a.prim, phase: a.phase ?? null, progress: Math.round(progress * 100) / 100, ...(a.help !== undefined ? { helping: a.help } : {}), ...(a.glyph ? { glyph: a.glyph } : {}), target: a.x !== undefined ? { x: a.x, y: a.y } : null, item: a.item ?? (a.kind ? NODE_KINDS[a.kind]?.item : null) ?? null, load, capacity: this.cfg.invCapacity, carrying, tools };
  }
  performAttack(c, target) {
    // Range 1 (reach), energy cost, hit chance, damage; injuries bleed. Death only via the health rule.
    if (!this.spendEnergy(c, 5)) return this.endStep(c, false, 'exhausted');
    const armed = c.inventory.stone_club ? 7 : c.inventory.hand_axe ? 5 : 0;
    if (c.inventory.stone_club) this.wearTool(c, 'stone_club');
    const hit = this.rng.next() < 0.65 + 0.2 * (c.personality.boldness - target.personality.boldness);
    target.lastAttacker = c.id; target.relationships[c.id] = clamp((target.relationships[c.id] ?? 0) - 0.5, -1, 1);
    let dmg = 0;
    if (hit) { dmg = 5 + this.rng.int(6) + armed; target.health -= dmg; target.injury = Math.min(400, target.injury + 60 + dmg * 10); target.stats.hurt++; target.lastDamage = { cause: 'injury', by: c.id, tick: this.tick }; }
    this.socialEvent('attack', c, target, hit ? `hit:${dmg}` : 'missed');
    if (target.act && target.act.prim !== 'attack') this.interrupt(target, 'attacked');
    return this.endStep(c, hit, hit ? null : 'missed', { social: 0 });
  }
  interrupt(c, why) { noteReplan(this, c, why); if (c.act) this.endStep(c, false, `interrupted:${why}`); c.plan = null; }
  dropToPile(x, y, item, n = 1) {
    let p = this.pileAt(x, y); const ch = this.chunkAt(x, y);
    if (!p) { p = { id: `p${this.nextId.pile++}`, x, y, items: {} }; ch.piles.push(p); ch.pileAt.set(y * 100000 + x, p); }
    p.items[item] = (p.items[item] ?? 0) + n; ch.dirty = true;
  }
  removePileIfEmpty(p) { if (Object.keys(p.items).length) return; const ch = this.chunkAt(p.x, p.y); ch.piles.splice(ch.piles.indexOf(p), 1); ch.pileAt.delete(p.y * 100000 + p.x); }
  extinguish(f, why) { const i = this.fires.indexOf(f); if (i >= 0) this.fires.splice(i, 1); this.emit('fire_out', { fire: f.id, why }); }
  discover(c, what) {
    const first = !this.discoveries.some((d) => d.what === what), own = !c.mind.discoveries.includes(what);
    if (own) { c.mind.discoveries.push(what); if (c.mind.discoveries.length > 24) c.mind.discoveries.shift(); }
    if (own) { this.discoveries.push({ tick: this.tick, what, by: c.id, firstInWorld: first, selfFound: !c.mind.observedFrom?.includes(what) }); if (this.discoveries.length > 500) this.discoveries.shift(); }
  }

  endStep(c, success, reason = null, extra = {}) {
    const a = c.act; if (!a) return;
    c.act = null;
    const duration = this.tick - a.started + 1, energy = a.before.energy - c.energy;
    const produced = {}; for (const [k, n] of Object.entries(c.inventory)) { const d = n - (a.before.inv[k] ?? 0); if (d > 0) produced[k] = d; }
    const consumed = {}; for (const [k, n] of Object.entries(a.before.inv)) { const d = n - (c.inventory[k] ?? 0); if (d > 0) consumed[k] = d; }
    // Acquisition drive counts only goods with a use the resident perceives: materials named by its demand at
    // decision time, food while it is not sated or carries little, and a tool it did not already hold. Surplus
    // material earns nothing, which removes the self-reinforcing gathering that produced the log carpet.
    const dem = c.plan?.demand, fed = Object.entries(c.inventory).reduce((t, [k, n]) => t + (FOOD[k] ? n : 0), 0);
    const useful = (k) => !dem ? true : FOOD[k] ? (c.hunger > 25 || fed <= 3) : TOOLS[k] || RECIPES_OUT.has(k) ? !(a.before.inv[k] > 0) : dem.includes(k) || (FUEL[k] && !!c.plan?.fire);
    const items = extra.transfer ? 0 : Object.entries(produced).reduce((s, [k, v]) => s + (useful(k) ? v : 0), 0); // moving goods out of a store is not production
    if (a.prim === 'gather' && success) for (const k of Object.keys(produced)) if (!FOOD[k]) { if (dem?.includes(k)) this.totals.demandGathers++; else this.totals.surplusGathers++; }
    // Reward = change of need-based wellbeing (designed) + small designed drives (acquisition, novelty, social).
    const novelItem = Object.keys(produced).some((k) => !c.mind.seenItems?.includes(k));
    if (novelItem) { c.mind.seenItems ??= []; for (const k of Object.keys(produced)) if (!c.mind.seenItems.includes(k)) c.mind.seenItems.push(k); }
    const reward = clamp(this.wellbeing(c) - a.before.wb + 0.12 * items + (novelItem ? 0.4 : 0) + (a.novel ? 0.05 * a.novel : 0) + (extra.social ?? 0) + (extra.fire ? 0.3 : 0) + 0.3 * (extra.progress ?? 0) + (extra.completed ? 0.6 : 0) + (extra.provision ?? 0) - (success ? 0 : 0.1), -2, 2);
    const outcome = { tick: this.tick, success, reward, duration, energy, produced };
    const learn = this.learning && this.mode !== 'frozen';
    if (learn) updateModel(c.mind, a.key, outcome);
    const pl = c.plan;
    if (pl) {
      if (pl.idx === 0 && pl.trace) reinforce(c.brain.mb, a.label, pl.trace, reward, this.tick, learn, pl.source === 'reflex' ? 'reflex' : 'model');
      pl.actual.push({ step: pl.idx, success, reason, reward: r3(reward), duration, energy: r3(energy), produced });
    }
    recordEpisode(c.mind, { tick: this.tick, key: a.key, success, reward: r3(reward), duration, produced, reason, x: c.x, y: c.y, novel: novelItem });
    if (success) onStep(this, c, a, produced, consumed, { stock: foodStock(c, (k) => FOOD[k] !== undefined).stored });
    // Persistent goal: credit the goal progress this step produced to (goal kind, step key); track failing strategies.
    if (pl?.goal && a.before.gm !== undefined) {
      const g = c.mind.goals.find((q) => q.id === pl.goal.id);
      if (g) learnGoal(c.mind, g, a.key, goalMetric(g.kind, c) - a.before.gm, success, this.tick, learn);
    }
    // Social observation: nearby creatures see the act and its visible result and update their OWN model at low weight.
    if (learn && (items > 0 || extra.fire || reason === 'no-result' || reason === 'salt-water' || extra.toxic) && a.prim !== 'move') {
      for (const o of this.creaturesNear(c.x, c.y, this.cfg.perception)) if (o !== c) {
        // the actor's context (e.g. visibly holding a tool) is part of what is observed, so the same key applies
        updateModel(o.mind, a.key, { ...outcome, reward: outcome.reward - (this.wellbeing(c) - a.before.wb) * 0.5 }, this.cfg.observeWeight);
        if (extra.fire || a.prim === 'combine') { o.mind.observedFrom ??= []; const w = a.prim === 'combine' ? `combine:${a.a}+${a.b}->${RECIPES[`${a.a}+${a.b}`]}` : 'fire:strike-flint-on-fuel'; if (!o.mind.observedFrom.includes(w)) { o.mind.observedFrom.push(w); if (o.mind.observedFrom.length > 16) o.mind.observedFrom.shift(); } }
      }
    }
    if (pl) {
      // A just-acquired cookable meal changes the resident's local options (fuel, ignition materials, an observed
      // fire and a hungry neighbour may now matter). Do not blindly consume it as the stale second step of a plan.
      // Critical hunger still uses the normal reflex path on the following decision.
      if (success && c.hunger < 85 && Object.keys(produced).some((k) => COOKING[k])) {
        this.totals.replans['food-acquired'] = (this.totals.replans['food-acquired'] ?? 0) + 1;
        this.finishPlan(c); return;
      }
      if (!success) { this.finishPlan(c); return; }
      pl.idx++;
      if (pl.idx < pl.raw.length) this.startStep(c); else this.finishPlan(c);
    }
  }
  finishPlan(c) {
    const pl = c.plan; if (!pl) return;
    const rec = { id: pl.id, tick: pl.tick, source: pl.source, steps: pl.steps, predicted: pl.predicted, value: pl.value, utility: pl.utility, mbPreference: pl.mbPreference, alternatives: pl.alternatives, actual: pl.actual, goal: pl.goal ?? null,
      predictedReward: r3(pl.predicted.reduce((s, p) => s + p.reward, 0)), actualReward: r3(pl.actual.reduce((s, p) => s + p.reward, 0)), completed: pl.actual.length === pl.steps.length && pl.actual.every((x) => x.success) };
    c.mind.plans.push(rec); if (c.mind.plans.length > LIMITS.plans) c.mind.plans.shift();
    c.mind.lastPlan = rec; c.plan = null;
  }

  // ---------------- world tick ----------------
  step() {
    this.tick++;
    if (this.tick % 200 === 0) this.pruneFollowers();
    if (this.tick % 300 === 0) { if (this.weather.rain && this.tick >= this.weather.until) this.weather.rain = false; else if (!this.weather.rain && this.rng.next() < 0.25) { this.weather = { rain: true, until: this.tick + 300 }; } }
    this.rebuildIndex();
    this.stepFires();
    if (this.tick % this.cfg.decayEvery === 0) this.stepShelters();
    if (this.tick % CROP.every === 0) this.stepCrops();
    const queue = [];
    for (const c of this.creatures) {
      this.needs(c);
      if (c.health <= 0) continue;
      if (c.signalWatch && this.tick >= c.signalWatch.until) this.settleWatch(c);
      if (c.act && (this.tick + c.id) % 5 === 0) this.checkInterrupt(c);
      if (c.act) this.stepAct(c);
      else if (c.following && c.hunger < 70 && c.thirst < 70 && c.warmth > 40 && c.energy > 10) { this.followStep(c); continue; }
      if (!c.act && c.health > 0) queue.push(c);
    }
    // Fair scheduling: bounded decisions per tick, served oldest-waiting first; others wait (never removed).
    queue.sort((a, b) => (a.waitSince ?? this.tick) - (b.waitSince ?? this.tick) || a.id - b.id);
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      if (i < this.cfg.maxDecisionsPerTick) { c.waitSince = null; this.decide(c); } else { c.waitSince ??= this.tick; this.totals.deferred++; }
    }
    this.lifecycle();
    if (this.tick % this.cfg.historyEvery === 0) { this.history.push(this.summary()); if (this.history.length > this.cfg.historyMax) this.history.shift(); }
  }
  followStep(c) {
    const l = this.getCreature(c.following.id);
    if (!l) { c.following = null; return; }
    if (Math.max(Math.abs(l.x - c.x), Math.abs(l.y - c.y)) > 2) {
      const p = this.findPath(c.x, c.y, l.x, l.y, true, 400);
      if (!p?.length) { c.followProgress = null; return; }
      const [nx, ny] = p[0], mc = this.moveCost(nx, ny);
      if (mc === Infinity) { c.followProgress = null; return; }
      if (!c.followProgress || c.followProgress.x !== nx || c.followProgress.y !== ny) c.followProgress = { x: nx, y: ny, ticks: 0 };
      c.followProgress.ticks++;
      if (c.followProgress.ticks < mc) return;
      const cost = 0.08 * mc + 0.01 * this.invWeight(c);
      c.followProgress = null;
      if (!this.spendEnergy(c, cost)) return;
      c.face = nx > c.x ? 1 : nx < c.x ? -1 : c.face; c.x = nx; c.y = ny; c.stats.moved++;
    } else {
      c.followProgress = null;
    }
  }
  needs(c) {
    const cf = this.cfg, juvenile = c.age < cf.adultAge;
    c.age++; if (c.cooldown > 0) c.cooldown--;
    const temp = this.effectiveTemp(c);
    const resting = c.act?.prim === 'rest';
    c.hunger = Math.min(100, c.hunger + cf.hungerRate * (juvenile ? 0.6 : 1) * (resting ? 0.6 : 1) * (temp < 5 ? 1.3 : 1));
    c.thirst = Math.min(100, c.thirst + cf.thirstRate * (1 + Math.max(0, temp - 26) / 8));
    // Warmth: cold exposure below 10C drains it; comfortable temperatures restore it.
    if (temp < 10) c.warmth = Math.max(0, c.warmth - (10 - temp) * 0.012); else c.warmth = Math.min(100, c.warmth + 0.25);
    let cause = null;
    if (!resting) c.energy = Math.max(0, c.energy - 0.02);
    if (c.energy <= 0) { c.health -= 0.03; cause = 'exhaustion'; }
    if (c.hunger >= 100) { c.health -= 0.08; cause = 'starvation'; } else if (c.hunger >= 90) { c.health -= 0.02; cause = 'starvation'; }
    if (c.thirst >= 100) { c.health -= 0.12; cause = 'dehydration'; }
    if (c.warmth < 25) { c.health -= 0.05 * (1 - c.warmth / 25) + 0.01; cause = 'exposure'; }
    if (c.injury > 0) { c.injury--; c.health -= 0.02; cause ??= 'injury'; if (c.lastDamage?.cause === 'injury') cause = 'injury'; }
    const onFire = this.fires.some((f) => f.x === c.x && f.y === c.y);
    if (onFire) { c.health -= 4; cause = 'burns'; }
    if (!cause && c.hunger < 60 && c.thirst < 60 && c.warmth > 50) c.health = Math.min(100, c.health + 0.03);
    if (c.age > c.lifespan) { c.health = 0; cause = 'old_age'; }
    if (c.health <= 0) c.deathCause = cause ?? 'unknown';
    if (c.following && this.tick >= c.following.until) c.following = null;
  }
  stepFires() {
    for (const f of this.fires.slice()) {
      f.fuel -= this.weather.rain ? 0.2 : 0.025;
      if (f.fuel <= 0) { this.extinguish(f, this.weather.rain ? 'rain' : 'fuel'); continue; }
      if ((this.tick + f.id) % 10) continue;
      const dry = { arid: 2, temperate: 1, cold: 0.3, coast: 0.5 }[this.biome(f.x, f.y)] * (this.weather.rain ? 0 : 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = this.nodeAt(f.x + dx, f.y + dy);
        if (!n || n.units <= 0 || !['tree', 'scrub', 'deadfall', 'bush', 'driftwood'].includes(n.kind)) continue;
        if (this.fires.some((o) => o.x === n.x && o.y === n.y)) continue;
        if (this.rng.next() < 0.03 * dry) {
          const item = NODE_KINDS[n.kind].item, u = n.units;
          this.totals.burnedNodes[item] = (this.totals.burnedNodes[item] ?? 0) + u; n.units = 0; n.t = this.tick; this.dirty(n.x, n.y);
          this.fires.push({ id: this.nextId.fire++, x: n.x, y: n.y, fuel: u * 3, lit: this.tick, by: null, spreadFrom: f.id });
          this.emit('fire_spread', { from: f.id, x: n.x, y: n.y, node: n.id });
        }
      }
    }
  }
  lifecycle() {
    const dead = this.creatures.filter((c) => c.health <= 0);
    for (const c of dead) {
      this.creatures.splice(this.creatures.indexOf(c), 1);
      for (const [k, n] of Object.entries(c.inventory)) this.dropToPile(c.x, c.y, k, n); // items stay in the world
      c.inventory = {};
      const cause = c.deathCause ?? c.lastDamage?.cause ?? 'unknown';
      this.totals.deaths++; this.totals.deathsByCause[cause] = (this.totals.deathsByCause[cause] ?? 0) + 1;
      this.graveyard.push({ id: c.id, name: c.name, tick: this.tick, age: c.age, cause, x: c.x, y: c.y, generation: c.generation, parents: c.parents });
      if (this.graveyard.length > this.cfg.graveyardMax) this.graveyard.shift();
      this.emit('death', { id: c.id, cause, age: c.age });
    }
    // Natural births: bonded adults, both nearby, fed/watered/warm, at a shelter or fire, no cooldown.
    for (const m of this.creatures) {
      if (m.sex !== 'F') continue;
      if (m.pregnant) { if (this.tick >= m.pregnant.due) this.birth(m); continue; }
      if (!this.isAdult(m) || m.cooldown > 0 || m.age > this.cfg.elderAge) continue;
      if (m.hunger > 50 || m.thirst > 50 || m.health < 60 || m.warmth < 50) continue;
      // Schema 4 household rule: a shelter has room for `cap` x 2 residents who call it home; a full household
      // must find or build another shelter (or use a fire) before conceiving. Nobody is ever removed by this rule.
      const sh = this.shelterAt(m.x, m.y);
      if (sh) { if (this.household(sh) >= sh.cap * 2) continue; } else if (!this.fireWarmth(m.x, m.y)) continue;
      const f = this.creaturesNear(m.x, m.y, 1).find((o) => o.sex === 'M' && this.isAdult(o) && o.cooldown === 0 && (m.relationships[o.id] ?? 0) > 0.4 && (o.relationships[m.id] ?? 0) > 0.4 && o.hunger < 50 && o.thirst < 50);
      if (!f) continue;
      m.pregnant = { father: f.id, due: this.tick + 80 }; m.cooldown = 600; f.cooldown = 600; m.hunger += 15; f.hunger += 6;
    }
  }
  household(sh) { let n = 0; for (const c of this.creatures) if (c.home.x === sh.x && c.home.y === sh.y) n++; return n; }
  birth(m) {
    const f = this.getCreature(m.pregnant.father);
    const kid = this.newCreature({ x: m.x, y: m.y, sex: this.rng.next() < 0.5 ? 'F' : 'M', age: 0, parents: [m.id, m.pregnant.father], parentsObj: [m, f ?? m] });
    kid.relationships[m.id] = 0.6; m.relationships[kid.id] = 0.6; kid.home = { ...m.home };
    for (const p of [m, f]) if (p) { p.children ??= []; p.children.push(kid.id); if (p.children.length > 12) p.children.shift(); }
    m.pregnant = null; m.stats.offspring++; if (f) f.stats.offspring++;
    this.creatures.push(kid); this.totals.births++;
    this.emit('birth', { id: kid.id, mother: m.id, father: f?.id ?? null });
  }
  run(n) { for (let i = 0; i < n; i++) this.step(); }

  // ---------------- leadership (observed pattern, not assigned) ----------------
  pruneFollowers(window = 2000) {
    for (const c of this.creatures) for (const [id, tick] of Object.entries(c.followers)) if (this.tick - tick > window) delete c.followers[id];
  }
  leadership(window = 2000) {
    const out = [];
    for (const c of this.creatures) { const f = Object.entries(c.followers).filter(([, t]) => this.tick - t <= window); if (f.length) out.push({ id: c.id, voluntaryFollowers: f.length }); }
    return out.sort((a, b) => b.voluntaryFollowers - a.voluntaryFollowers);
  }
  summary() {
    const by = {}; for (const c of this.creatures) { const b = this.biome(c.x, c.y); by[b] = (by[b] ?? 0) + 1; }
    let sites = 0, standing = 0, stored = 0;
    for (const s of this.shelters) { if (s.complete === false) sites++; else if (s.integrity > 0) standing++; stored += sum(s.store ?? {}); }
    return { tick: this.tick, population: this.creatures.length, byBiome: by, fires: this.fires.length, shelters: this.shelters.length - sites, sites, standing, stored, fishCaught: this.totals.gathered.fish ?? 0, crops: this.crops.length, ripeCrops: this.crops.filter((q) => q.ripe).length, ruins: this.shelters.filter((s) => s.complete !== false && s.integrity <= 0).length, signals: this.totals.signals ?? 0, chunks: [...this.chunks.values()].filter((ch) => ch.dirty).length, births: this.totals.births, deaths: this.totals.deaths };
  }
  // Holdings per item across inventories and ground piles (for conservation checks).
  holdings() {
    const h = {};
    for (const c of this.creatures) for (const [k, n] of Object.entries(c.inventory)) h[k] = (h[k] ?? 0) + n;
    for (const ch of this.chunks.values()) for (const p of ch.piles) for (const [k, n] of Object.entries(p.items)) h[k] = (h[k] ?? 0) + n;
    for (const s of this.shelters) for (const [k, n] of Object.entries(s.store ?? {})) h[k] = (h[k] ?? 0) + n;
    return h;
  }

  // ---------------- persistence ----------------
  toState() {
    const chunks = [];
    for (const ch of this.chunks.values()) if (ch.dirty) chunks.push({ cx: ch.cx, cy: ch.cy, tiles: Buffer.from(ch.tiles).toString('base64'), nodes: ch.nodes, piles: ch.piles });
    const creatures = this.creatures.map((c) => { const { lastObs, ...rest } = c; return { ...rest, plan: c.plan ? { ...c.plan } : null, act: c.act ? { ...c.act } : null }; });
    return { id: this.id, legacyArchive: this.legacyArchive, kind: 'stratoks-expanse', schema: EXPANSE_SCHEMA, seed: this.seed, cfg: this.cfg, tick: this.tick, seq: this.seq, rng: this.rng.s, mode: this.mode, learning: this.learning,
      base: { tiles: Buffer.from(this.base.tiles).toString('base64'), trees: this.base.trees, stones: this.base.stones, bushes: this.base.bushes },
      chunks, fires: this.fires, shelters: this.shelters, crops: this.crops, signals: this.signals, creatures, graveyard: this.graveyard, events: this.events, social: this.social, discoveries: this.discoveries,
      history: this.history, totals: this.totals, weather: this.weather, nextId: this.nextId, chainLog: this.chainLog, ...(this.migrations ? { migrations: this.migrations } : {}) };
  }
  static fromState(s, cfgOverride = {}) {
    if (s.kind !== 'stratoks-expanse') throw new Error('not an expanse snapshot');
    if (s.schema !== EXPANSE_SCHEMA) throw new Error(`expanse schema ${s.schema} requires migration to ${EXPANSE_SCHEMA}`);
    const e = new Expanse({ ...s.cfg, ...cfgOverride });
    const st = structuredClone(s);
    Object.assign(e, { id: st.id, legacyArchive: st.legacyArchive, seed: st.seed, schema: st.schema, tick: st.tick, seq: st.seq, mode: cfgOverride.mode ?? st.mode, learning: cfgOverride.learning ?? st.learning, fires: st.fires, shelters: st.shelters, crops: st.crops ?? [], signals: st.signals ?? [],
      creatures: st.creatures, graveyard: st.graveyard, events: st.events, social: st.social, discoveries: st.discoveries, history: st.history, totals: st.totals, weather: st.weather, nextId: st.nextId, ...(st.migrations ? { migrations: st.migrations } : {}) });
    e.rng = new Rng(1); e.rng.s = st.rng >>> 0;
    e.base = { tiles: decodeTiles(st.base.tiles), trees: st.base.trees, stones: st.base.stones, bushes: st.base.bushes };
    e.chunks = new Map();
    for (const c of st.chunks) {
      const fresh = generateChunk(e.seed, c.cx, c.cy, e.base);
      const ch = { cx: c.cx, cy: c.cy, tiles: decodeTiles(c.tiles), biome: fresh.biome, nodes: c.nodes, piles: c.piles, dirty: true };
      e.indexChunk(ch); e.chunks.set(chunkKey(c.cx, c.cy), ch);
    }
    for (const [cx, cy] of st.generated ?? []) e.chunk(cx, cy); // pristine chunks regenerate deterministically
    for (const c of e.creatures) { c.energy = clamp(c.energy ?? 80, 0, 100); c.mind ??= createMind(); c.mind.shelters ??= []; c.mind.memoryVersion = MEMORY_VERSION; c.toolWear ??= {}; c.fromStore ??= {}; ensureAgency(c); c.mind.homes ??= {}; ensureChains(c); ensureMushroom(c.brain, e.seed, c.id); }
    e.chainLog = st.chainLog ?? []; ensureWorldChains(e);
    return e;
  }
}

// Item ledger: what holdings() must equal for every item, from the totals alone. Salvage/deposit/retrieve/share
// are transfers and do not appear. Cooking converts raw to cooked 1:1; harvesting creates the crop yield.
export function expectedHoldings(t) {
  const plus = [t.gathered, t.crafted, t.harvested, t.cookedOut], minus = [t.craftUsed, t.eaten, t.burnedItems, t.built, t.repaired, t.wornOut, t.planted, t.cookedIn, t.mendUsed];
  const out = {};
  for (const o of plus) for (const [k, v] of Object.entries(o ?? {})) out[k] = (out[k] ?? 0) + v;
  for (const o of minus) for (const [k, v] of Object.entries(o ?? {})) out[k] = (out[k] ?? 0) - v;
  return out;
}
// Totals added in schema 5 (conservation terms and evidence counters).
export function schema5Totals() { return { planted: {}, harvested: {}, withered: {}, cookedIn: {}, cookedOut: {}, salvaged: {}, helped: {}, heatUsed: 0, signals: 0, signalsHeard: 0, signalsMisheard: 0, signalsFeedback: 0, responses: 0, signalCredit: 0 }; }
const RECIPES_OUT = new Set(Object.values(RECIPES));
function pick0(cands, chosen) { return cands.find((q) => q.u === chosen.u && q.pref === chosen.pref)?.seq; }
function usable(s) { return s.complete !== false && s.integrity > 0; }
// The save format is unchanged. Browser workers restore the exact same snapshot
// without a Node Buffer polyfill or a replacement simulation.
function decodeTiles(value) { return typeof Buffer !== 'undefined' ? Uint8Array.from(Buffer.from(value, 'base64')) : Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function sum(o) { let t = 0; for (const v of Object.values(o)) t += v; return t; }
export function missingMaterials(s) { return Object.keys(s.need ?? {}).filter((k) => (s.materials?.[k] ?? 0) < s.need[k]).sort(); }
// A shelter that existed before schema 4 (or came from the Phase 2A settlement) is finished: its materials were
// already consumed by the earlier rules, so they are recorded as delivered without touching item totals.
export function prebuiltShelter(s, biome) {
  const S = STRUCTURES[biome] ?? STRUCTURES.temperate;
  s.kind ??= S.kind; s.biome ??= biome; s.stage = 3; s.complete = true; s.need ??= { ...S.need }; s.materials ??= { ...s.need };
  s.workNeed ??= S.work; s.work ??= s.workNeed; s.store ??= {}; s.integrity = Math.max(0, Math.min(100, s.integrity ?? 100)); s.prebuilt = true;
  return s;
}
function describe(s) { const { key, label, consumes, firstOnly, ...rest } = s; return { ...rest, key, label }; }
function r3(v) { return Math.round((v ?? 0) * 1000) / 1000; }
function hpush(h, v) { h.push(v); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function hpop(h) { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; }
