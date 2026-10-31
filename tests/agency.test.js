// Schema 5 checks: the three engine defects (distant stock leak, ruins acting as stores/homes, build step reported
// idle), crops, cooking, voluntary help, persistent goals with interruption/resumption/alternatives, limited learned
// signalling (range, attention, misperception, no intrinsic reward, no loops), conservation and v4 -> v5 migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Expanse, EXPANSE_SCHEMA, expectedHoldings } from '../server/src/expanse/engine.js';
import { T, FISH_WATER, NODE_KINDS } from '../server/src/expanse/terrain.js';
import { save, load, restore, readState, identityDigest, migrateExpanse, SNAPSHOT } from '../server/src/expanse/persist.js';
import { frame, viewport, inspect } from '../server/src/expanse/view.js';
import { CROPS, CROP, COOK, GLYPHS } from '../server/src/expanse/capabilities.js';
import { GOAL_LIMITS, SIGNAL, updateGoals, goalBias, goalMetric, ensureAgency } from '../server/src/expanse/agency.js';
import { markVisited, LIMITS } from '../server/src/expanse/agent.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const V4 = path.join(here, 'fixtures', 'expanse-v4');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agency-'));
const mk = (seed = 11, n = 24, cfg = {}) => Expanse.create({ initialCount: n, ...cfg }, { seed });
// Test staging changes inventories directly; the change is booked as `gathered` so the item ledger stays checkable.
function stage(e, c, inv = {}) { for (const k of new Set([...Object.keys(c.inventory), ...Object.keys(inv)])) e.totals.gathered[k] = (e.totals.gathered[k] ?? 0) + (inv[k] ?? 0) - (c.inventory[k] ?? 0); c.inventory = { ...inv }; c.act = null; c.plan = null; c.hunger = 10; c.thirst = 10; c.warmth = 90; c.health = 100; c.energy = 90; }
function run(e, c, step, max = 300, each = null) {
  c.plan = { id: 0, tick: e.tick, source: 'test', steps: [step], predicted: [], actual: [], raw: [{ key: step.key ?? 'test|x|', label: step.label ?? 'WANDER', ...step }], idx: 0 };
  e.startStep(c);
  for (let i = 0; i < max && c.act; i++) { e.tick++; e.rebuildIndex(); e.stepAct(c); each?.(c); }
  return c.mind.plans.at(-1)?.actual.at(-1);
}
function place(e, c, x, y) { c.x = x; c.y = y; e.rebuildIndex(); }
function freeSpot(e, x0, y0, ok = () => true) { for (let r = 0; r < 80; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = x0 + dx, y = y0 + dy; if (e.passable(x, y) && !FISH_WATER.has(e.tile(x, y)) && !e.nodeAt(x, y) && !e.pileAt(x, y) && !e.shelters.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < 5) && !e.crops.some((q) => q.x === x && q.y === y) && ok(x, y)) return { x, y }; } return null; }
function shelterAt(e, p, by) { const s = e.newStructure(p.x, p.y, by); Object.assign(s, { complete: true, stage: 3, materials: { ...s.need }, work: s.workNeed }); e.shelters.push(s); return s; }
function spotWhere(e, ok) { const b = e.bounds(); for (let y = b.y0 + 2; y < b.y1 - 2; y += 2) for (let x = b.x0 + 2; x < b.x1 - 2; x += 2) if (ok(x, y)) { const s = freeSpot(e, x, y, (xx, yy) => ok(xx, yy)); if (s) return s; } return null; }
const sum = (o) => Object.values(o ?? {}).reduce((t, v) => t + v, 0);
function ledgerOk(e, label) {
  const h = e.holdings(), exp = expectedHoldings(e.totals);
  for (const it of new Set([...Object.keys(h), ...Object.keys(exp)])) assert.equal(h[it] ?? 0, exp[it] ?? 0, `${label}: item ${it}`);
}

test('defect 6: distant sight never reveals store contents; only a visit updates stock memory; no planner leak', () => {
  const e = mk(11), [a, b] = e.creatures, p = freeSpot(e, 24, 24), s = shelterAt(e, p, a.id);
  s.store = { berry: 9, wood: 3 };
  stage(e, b); const far = freeSpot(e, s.x + 5, s.y, (x, y) => Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) >= 4); place(e, b, far.x, far.y);
  const obs = e.perceive(b);
  const seen = obs.shelters.find((q) => q.id === s.id);
  assert.ok(seen, 'shelter visible from afar'); assert.equal(seen.store, undefined, 'observation carries no store contents');
  const mem = b.mind.shelters.find((q) => q.id === s.id);
  assert.equal(mem.stock, null, 'never visited => unknown'); assert.equal(mem.visited ?? null, null);
  // planner affordances: nothing to retrieve from a store it has only seen
  assert.ok(!e.affordances(b, obs)(b.inventory, null).some((st) => st.prim === 'retrieve'), 'no retrieve from sight');
  assert.equal(inspect(e, b.id).knownStores.find((q) => q.id === s.id).stock, null);
  // a visit (deposit) records the real contents ...
  stage(e, b, { stone: 1 }); place(e, b, s.x, s.y + 1);
  assert.equal(run(e, b, { prim: 'deposit', shelter: s.id, x: s.x, y: s.y, item: 'stone', key: 'deposit|material|' }).success, true);
  assert.deepEqual(b.mind.shelters.find((q) => q.id === s.id).stock, { berry: 9, wood: 3, stone: 1 });
  // ... then it walks away; the store changes out of reach; looking at it again from afar keeps the stale memory
  place(e, b, far.x, far.y); s.store = {}; e.tick += 5; e.perceive(b);
  const stale = b.mind.shelters.find((q) => q.id === s.id);
  assert.deepEqual(stale.stock, { berry: 9, wood: 3, stone: 1 }, 'memory stays stale until revisited');
  assert.ok(inspect(e, b.id).knownStores.find((q) => q.id === s.id).staleTicks >= 5);
  // a stale memory can drive a retrieve attempt, which fails on arrival and corrects the memory
  stage(e, b); place(e, b, s.x, s.y + 1);
  assert.equal(run(e, b, { prim: 'retrieve', shelter: s.id, x: s.x, y: s.y, item: 'berry', key: 'retrieve|food|' }).reason, 'store-empty');
  assert.deepEqual(b.mind.shelters.find((q) => q.id === s.id).stock, {});
});

test('defect 7: a ruin is not a store or home; contents are preserved; only repair or explicit nearby salvage recovers them', () => {
  const e = mk(11), [a, b] = e.creatures, p = freeSpot(e, 30, 30), s = shelterAt(e, p, a.id);
  s.store = { berry: 4, stone: 2 }; s.integrity = 0;
  const h0 = e.holdings();
  assert.equal(e.shelterAt(s.x, s.y), null, 'no warmth/rest/birth protection');
  stage(e, a, { wood: 1 }); place(e, a, s.x, s.y + 1);
  assert.equal(run(e, a, { prim: 'deposit', shelter: s.id, x: s.x, y: s.y, item: 'wood', key: 'deposit|material|' }).reason, 'ruined');
  stage(e, a); assert.equal(run(e, a, { prim: 'retrieve', shelter: s.id, x: s.x, y: s.y, item: 'berry', key: 'retrieve|food|' }).reason, 'ruined');
  assert.deepEqual(s.store, { berry: 4, stone: 2 }, 'contents preserved'); assert.deepEqual(e.holdings(), h0);
  // remembered as ruined: not offered as a home/store target, not counted as a known shelter
  const mem = a.mind.shelters.find((q) => q.id === s.id); assert.equal(mem.ruined, true);
  assert.equal(e.nearestKnownShelter(a), null);
  const steps = e.affordances(a, e.perceive(a))(a.inventory, null);
  assert.ok(!steps.some((st) => ['deposit', 'retrieve'].includes(st.prim) && st.shelter === s.id));
  assert.ok(!steps.some((st) => st.prim === 'move' && st.purpose === 'shelter' && st.x === s.x && st.y === s.y));
  assert.ok(steps.some((st) => st.prim === 'salvage' && st.shelter === s.id), 'explicit nearby salvage offered');
  // view: listed as a ruin, not as a home
  const v = viewport(e, s.x - 5, s.y - 5, 12, 12);
  assert.ok(!v.shelters.some((t) => t[0] === s.id)); assert.ok(v.ruins.some((r) => r.id === s.id && r.usable === false && r.stored === 6));
  assert.equal(frame(e, { x: s.x - 5, y: s.y - 5, w: 12, h: 12 }).places.find((q) => q.id === s.id).ruined, true);
  // salvage takes stored goods out (a transfer, conserved) and cannot be used on a standing shelter
  stage(e, b); place(e, b, s.x + 1, s.y);
  const r = run(e, b, { prim: 'salvage', shelter: s.id, x: s.x, y: s.y, key: 'salvage|timber_home|' });
  assert.equal(r.success, true); assert.equal(b.inventory.berry, 3); assert.equal(s.store.berry, 1); assert.deepEqual(e.holdings(), h0);
  assert.equal(e.totals.salvaged.berry, 3);
  // repair brings it back into normal use
  stage(e, a, { wood: 1 });
  assert.equal(run(e, a, { prim: 'repair', shelter: s.id, x: s.x, y: s.y, item: 'wood', key: 'repair|wood|timber_home' }).success, true);
  assert.ok(e.shelterAt(s.x, s.y)); assert.equal(a.mind.shelters.find((q) => q.id === s.id).ruined, false);
  stage(e, b); assert.equal(run(e, b, { prim: 'salvage', shelter: s.id, x: s.x, y: s.y, key: 'salvage|timber_home|' }).reason, 'not-ruined');
  stage(e, a, { wood: 1 }); assert.equal(run(e, a, { prim: 'deposit', shelter: s.id, x: s.x, y: s.y, item: 'wood', key: 'deposit|material|' }).success, true);
});

test('defect 8: a newly chosen build step reports starting, then construct with progress; never idle while a step runs', () => {
  const e = mk(11), c = e.creatures[0], p = freeSpot(e, 26, 26);
  stage(e, c, { wood: 4, stone: 2 }); place(e, c, p.x, p.y);
  c.plan = { id: 0, tick: e.tick, source: 'test', steps: [], predicted: [], actual: [], raw: [{ prim: 'build', key: 'build|found|timber_home:dry', label: 'BUILD', consumes: ['wood', 'stone'] }], idx: 0 };
  e.startStep(c);
  let a = e.activity(c); assert.equal(a.state, 'starting'); assert.equal(a.progress, 0);
  const states = [];
  for (let i = 0; i < 200 && c.act; i++) { e.tick++; e.rebuildIndex(); e.stepAct(c); if (c.act) states.push(e.activity(c).state); }
  assert.ok(!states.includes('idle'), 'never idle during a build');
  assert.ok(states.includes('construct'));
  // contribute to the founded site from a fresh plan: starting first, then construct
  const q2 = freeSpot(e, p.x + 8, p.y), site = e.newStructure(q2.x, q2.y, c.id); e.shelters.push(site);
  stage(e, c, { wood: 4, stone: 2 }); place(e, c, q2.x, q2.y + 1);
  c.plan = { id: 0, tick: e.tick, source: 'test', steps: [], predicted: [], actual: [], raw: [{ prim: 'build', site: site.id, x: site.x, y: site.y, key: 'build|contribute|timber_home', label: 'BUILD' }], idx: 0 };
  e.startStep(c); assert.equal(e.activity(c).state, 'starting');
  e.tick++; e.rebuildIndex(); e.stepAct(c); assert.ok(['construct', 'travel'].includes(e.activity(c).state));
  // whole-world scan: idle only when there is no step
  const w = mk(5);
  for (let t = 0; t < 1500; t++) { w.step(); if (t % 10) continue; for (const r of w.creatures) { const s = w.activity(r).state; if (s === 'idle') assert.equal(r.act, null); if (r.act) assert.notEqual(s, 'idle'); } }
});

test('plant/tend/harvest: soil, climate and water decide growth; yields enter the world and are conserved', () => {
  const e = mk(11), c = e.creatures[0];
  const wet = spotWhere(e, (x, y) => e.biome(x, y) === 'temperate' && [T.GRASS, T.FOREST].includes(e.tile(x, y)) && e.naturalWater(x, y));
  assert.ok(wet);
  stage(e, c, { berry: 2 }); place(e, c, wet.x, wet.y); const h0 = sum(e.holdings());
  assert.equal(run(e, c, { prim: 'plant', item: 'berry', key: 'plant|berry|' }).success, true);
  const crop = e.crops.at(-1); assert.equal(crop.kind, 'berry'); assert.equal(c.inventory.berry, 1);
  assert.equal(e.activity(c).state, 'idle');
  for (let i = 0; i < CROPS.berry.grow; i++) { e.tick = Math.ceil((e.tick + 1) / CROP.every) * CROP.every; e.stepCrops(); }
  assert.equal(crop.ripe, true);
  const r = run(e, c, { prim: 'harvest', crop: crop.id, x: crop.x, y: crop.y, kind: 'berry', key: 'harvest|berry|' });
  assert.equal(r.success, true); assert.equal(c.inventory.berry, 1 + CROPS.berry.yield);
  assert.equal(sum(e.holdings()), h0 - 1 + CROPS.berry.yield); ledgerOk(e, 'harvest');
  // wrong soil keeps the seed; cold climate withers a desert plant; dry ground withers without tending
  const sand = spotWhere(e, (x, y) => e.tile(x, y) === T.ROCK);
  if (sand) { stage(e, c, { berry: 1 }); place(e, c, sand.x, sand.y); assert.equal(run(e, c, { prim: 'plant', item: 'berry', key: 'plant|berry|' }).reason, 'barren-ground'); assert.equal(c.inventory.berry, 1); }
  e.weather.rain = false;
  const dry = spotWhere(e, (x, y) => e.biome(x, y) === 'temperate' && e.tile(x, y) === T.GRASS && !e.naturalWater(x, y, CROP.tendWaterReach + 1));
  stage(e, c, { berry: 1 }); place(e, c, dry.x, dry.y);
  assert.equal(run(e, c, { prim: 'plant', item: 'berry', key: 'plant|berry|' }).success, true);
  const q = e.crops.at(-1);
  // tending needs fresh water near the crop: none here
  assert.equal(run(e, c, { prim: 'tend', crop: q.id, x: q.x, y: q.y, key: 'tend|berry|dry' }).reason, 'no-water-near');
  for (let i = 0; i < 12 && e.crops.includes(q); i++) { e.tick = Math.ceil((e.tick + 1) / CROP.every) * CROP.every; e.stepCrops(); }
  assert.ok(!e.crops.includes(q), 'unwatered crop withered'); assert.ok(e.totals.withered.berry >= 1);
  const cold = spotWhere(e, (x, y) => e.biome(x, y) === 'cold' && [T.SAND, T.DUNE].includes(e.tile(x, y)));
  if (cold) { stage(e, c, { cactus_fruit: 1 }); place(e, c, cold.x, cold.y); if (run(e, c, { prim: 'plant', item: 'cactus_fruit', key: 'plant|cactus_fruit|' }).success) { const k = e.crops.at(-1); for (let i = 0; i < 20 && e.crops.includes(k); i++) { e.tick = Math.ceil((e.tick + 1) / CROP.every) * CROP.every; e.stepCrops(); } assert.ok(!k.ripe); } }
  // tending a crop near water restores moisture
  const near = spotWhere(e, (x, y) => e.biome(x, y) === 'temperate' && e.tile(x, y) === T.GRASS && !e.naturalWater(x, y) && e.naturalWater(x, y, CROP.tendWaterReach));
  stage(e, c, { berry: 1 }); place(e, c, near.x, near.y); run(e, c, { prim: 'plant', item: 'berry', key: 'plant|berry|' });
  const t = e.crops.at(-1); t.moisture = 0;
  assert.equal(run(e, c, { prim: 'tend', crop: t.id, x: t.x, y: t.y, key: 'tend|berry|dry' }).success, true); assert.ok(t.moisture > 0);
  ledgerOk(e, 'crops');
});

test('cooking: heat from a fire converts raw food 1:1, spends fuel, scorches non-cookables and needs enough fuel', () => {
  const e = mk(11), c = e.creatures[0], p = freeSpot(e, 28, 20);
  stage(e, c, { fish: 2, cactus_fruit: 1 }); place(e, c, p.x, p.y + 1);
  const f = { id: e.nextId.fire++, x: p.x, y: p.y, fuel: 4, lit: e.tick, by: null }; e.fires.push(f);
  // ledger: the fire was not lit by burning items here, so only cooking terms change
  const h0 = e.holdings();
  assert.equal(e.activity(c).state, 'idle');
  let r = run(e, c, { prim: 'cook', item: 'fish', fire: f.id, x: f.x, y: f.y, key: 'cook|fish|' }, 300, (cc) => { if (cc.act) assert.equal(e.activity(cc).state, cc.act.phase ? 'cook' : 'starting'); });
  assert.equal(r.success, true); assert.equal(c.inventory.fish, 1); assert.equal(c.inventory.cooked_fish, 1);
  assert.equal(f.fuel, 4 - COOK.heat); assert.equal(sum(e.holdings()), sum(h0));
  r = run(e, c, { prim: 'cook', item: 'cactus_fruit', fire: f.id, x: f.x, y: f.y, key: 'cook|cactus_fruit|' });
  assert.equal(r.reason, 'scorched'); assert.equal(c.inventory.cactus_fruit, 1); assert.equal(f.fuel, 4 - 2 * COOK.heat);
  f.fuel = 1;
  assert.equal(run(e, c, { prim: 'cook', item: 'fish', fire: f.id, x: f.x, y: f.y, key: 'cook|fish|' }).reason, 'fire-too-low');
  ledgerOk(e, 'cook');
  // cooked fish is better food than raw fish (designed physics)
  stage(e, c, { cooked_fish: 1 }); c.hunger = 80;
  run(e, c, { prim: 'use', item: 'cooked_fish', on: 'self', key: 'use|cooked_fish@self|', label: 'EAT' });
  assert.equal(c.hunger, 80 - 44);
});

test('voluntary help: provisioning and repairing another resident\'s shelter come from own observations and relationships', () => {
  const e = mk(11), [a, b] = e.creatures, p = freeSpot(e, 22, 30), s = shelterAt(e, p, a.id);
  stage(e, a); stage(e, b, { berry: 3, wood: 1 }); a.home = { x: s.x, y: s.y };
  place(e, a, s.x, s.y); place(e, b, s.x + 2, s.y);
  // b has not yet seen a living there: no help offered
  a.hunger = 75; a.act = { prim: 'rest', started: e.tick, work: 1, phase: 'rest', before: { wb: 0, energy: a.energy, inv: {} } };
  b.mind.homes = {};
  // b observes a resting at the shelter that is a's home -> learns whose home it is
  const obs = e.perceive(b); assert.equal(b.mind.homes[a.id], s.id);
  const steps = e.affordances(b, obs)(b.inventory, null);
  const give = steps.find((st) => st.prim === 'deposit' && st.help === a.id);
  assert.ok(give, 'provision help offered'); assert.match(give.key, /^deposit\|food\|help:/);
  a.act = null; const h0 = e.holdings();
  const r = run(e, b, give);
  assert.equal(r.success, true); assert.equal(s.store.berry, 3); assert.deepEqual(e.holdings(), h0); assert.equal(e.totals.helped.provision, 3);
  assert.ok(e.social.some((q) => q.type === 'help' && q.actor === b.id && q.target === a.id));
  // worn shelter of another resident: repair carries a help key; no designed drive is attached to helping
  s.integrity = 50; const obs2 = e.perceive(b);
  const rep = e.affordances(b, obs2)(b.inventory, null).find((st) => st.prim === 'repair' && st.shelter === s.id);
  assert.ok(rep && rep.help === a.id && /help:/.test(rep.key));
  assert.equal(e.needBias(b, give), 0);
  stage(e, b, { wood: 1 }); assert.equal(run(e, b, rep).success, true); assert.equal(e.totals.helped.repair, 1); assert.equal(s.integrity, 80);
  // a resident never receives "help" affordances for its own home
  a.mind.homes = { [a.id]: s.id }; stage(e, a, { wood: 1 }); s.integrity = 50;
  const own = e.affordances(a, e.perceive(a))(a.inventory, null).find((st) => st.prim === 'repair');
  assert.ok(own && own.help === undefined);
});

test('persistent goals: bounded, interrupted by danger, resumed, and failing strategies are replaced by alternatives', () => {
  const e = mk(11), c = e.creatures[0];
  stage(e, c); c.hunger = 70; c.thirst = 70;
  let g = updateGoals(c, e.tick, false);
  assert.equal(g.kind, 'water'); assert.ok(c.mind.goals.some((q) => q.kind === 'food' && q.status === 'pending'));
  // danger outranks; the water goal is suspended (not dropped) and resumes afterwards
  c.lastAttacker = null; g = updateGoals(c, e.tick, true); assert.equal(g.kind, 'safety');
  const water = c.mind.goals.find((q) => q.kind === 'water'); assert.equal(water.status, 'suspended'); assert.equal(water.interruptions, 1);
  c.lastDanger = e.tick; e.tick += 100; g = updateGoals(c, e.tick, false);
  assert.equal(g.kind, 'water'); assert.equal(water.resumed, 1);
  assert.ok(c.mind.goalHistory.some((h) => h.kind === 'safety' && h.how === 'achieved'));
  // bounded
  c.warmth = 10; c.energy = 10; updateGoals(c, e.tick, true);
  assert.ok(c.mind.goals.length <= GOAL_LIMITS.goals);
  // interruption of a running step by a fire on the tile; the step ends with interrupted:danger
  stage(e, c); c.hunger = 70; const p = freeSpot(e, 30, 26); place(e, c, p.x, p.y);
  c.plan = { id: 1, tick: e.tick, source: 'test', steps: [], predicted: [], actual: [], raw: [{ prim: 'rest', key: 'rest|open|temperate', label: 'REST' }], idx: 0, goal: { id: 99, kind: 'rest' } };
  e.startStep(c); e.fires.push({ id: e.nextId.fire++, x: c.x, y: c.y, fuel: 5, lit: e.tick, by: null });
  assert.equal(e.checkInterrupt(c), true); assert.equal(c.act, null);
  assert.equal(c.mind.plans.at(-1).actual.at(-1).reason, 'interrupted:danger');
  e.fires.length = 0;
  // alternative strategies: two failures of the same first step for a goal -> it is avoided
  stage(e, c); c.mind.goals = []; c.hunger = 80; const fg = updateGoals(c, e.tick, false); assert.equal(fg.kind, 'food');
  const key = 'gather|fish|bare';
  for (let i = 0; i < 2; i++) {
    c.plan = { id: 2 + i, tick: e.tick, source: 'test', steps: [], predicted: [], actual: [], raw: [{ prim: 'use', item: 'stone', on: 'self', key, label: 'EAT' }], idx: 0, goal: { id: fg.id, kind: 'food' } };
    c.inventory = { stone: 1 }; e.startStep(c); for (let k = 0; k < 5 && c.act; k++) { e.tick++; e.stepAct(c); }
  }
  assert.ok(fg.avoid.includes(key)); assert.ok(c.mind.goalModel[`food|${key}`].n >= 2);
  // the decision then carries a negative goal bias for that strategy
  assert.equal(goalBias(c.mind, fg, key), -1);
  // a whole run: goals are recorded in plans and bounded
  const w = mk(3); w.run(2000);
  assert.ok(w.creatures.some((r) => r.mind.goalHistory.length > 0));
  for (const r of w.creatures) { assert.ok(r.mind.goals.length <= GOAL_LIMITS.goals); assert.ok(Object.keys(r.mind.goalModel).length <= GOAL_LIMITS.goalModel); assert.ok(r.mind.goalHistory.length <= GOAL_LIMITS.history); }
  assert.ok(w.creatures.some((r) => r.mind.plans.some((pl) => pl.goal && pl.goal.kind)));
});
test('signals: neutral glyphs, bounded range, attention, misperception, no intrinsic reward and no dictionary', () => {
  const e = mk(11), [a, b, c] = e.creatures, p = freeSpot(e, 28, 28);
  stage(e, a); stage(e, b); stage(e, c);
  place(e, a, p.x, p.y); place(e, b, p.x + 2, p.y); place(e, c, p.x + SIGNAL.range + 3, p.y);
  b.mind.heard = []; c.mind.heard = [];
  let heard = 0, mis = 0;
  for (let i = 0; i < 200; i++) {
    a.signalCooldown = 0; b.mind.heard = [];
    const r = run(e, a, { prim: 'signal', glyph: GLYPHS[0], ctx: 'none', key: `signal|${GLYPHS[0]}|none`, label: 'SOCIALIZE' });
    assert.equal(r.success, true); assert.ok(r.reward <= 0.001, `signalling has no intrinsic reward (${r.reward})`);
    if (b.mind.heard.length) { heard++; if (b.mind.heard.at(-1).glyph !== GLYPHS[0]) mis++; }
  }
  assert.equal(c.mind.heard.length, 0, 'out of range never hears');
  assert.ok(heard > 100 && heard < 200, `attention is partial (${heard}/200)`);
  assert.ok(mis > 0 && mis < heard / 3, `some misperception (${mis})`);
  assert.ok(Object.keys(b.mind.signals).length <= SIGNAL.associations);
  // the receiver gets the glyph and where it came from, nothing else: no translated meaning anywhere in its observation
  const obs = e.perceive(b);
  for (const h of obs.heard) assert.deepEqual(Object.keys(h).sort(), ['conf', 'dist', 'from', 'glyph', 'sig', 'tick', 'x', 'y']);
  assert.ok(!JSON.stringify(obs.heard).match(/food|danger|water|fish|help/));
  // a response is a walk to the source; its payoff is learned from the receiver's own wellbeing after arrival
  stage(e, b); const h = b.mind.heard.at(-1) ?? { glyph: GLYPHS[0], from: a.id, sig: e.signals.at(-1).id, x: a.x, y: a.y };
  const key = `respond|${h.glyph}|unknown`;
  run(e, b, { prim: 'move', purpose: 'respond', x: a.x, y: a.y + 1, glyph: h.glyph, from: a.id, sig: h.sig, key, label: 'APPROACH' });
  assert.ok(b.signalWatch); b.hunger = 2; e.tick = b.signalWatch.until; e.settleWatch(b);
  assert.ok(b.mind.model[key].n >= 1); assert.ok(b.mind.signals[h.glyph].n >= 1); assert.ok((b.trust[a.id] ?? 0) > 0);
  assert.ok(inspect(e, b.id).communication.associations.some((q) => q.glyph === h.glyph && q.confidence > 0));
  // communication disabled: no signal or respond affordances at all
  const off = mk(11, 24, { communication: false }); off.run(600);
  assert.equal(off.totals.signals, 0); assert.equal(off.totals.responses, 0);
});

test('no social reward loops: signal credit is bounded, needs a real positive gain and a tie, and help has no designed drive', () => {
  for (const seed of [3, 7]) {
    const e = mk(seed); e.run(2500);
    const T_ = e.totals;
    // credit can only come from a settled response with gain; it is capped per response
    assert.ok(T_.signalCredit <= SIGNAL.creditCap * T_.responses + 1e-9, `credit ${T_.signalCredit} <= cap*responses`);
    // signalling does not crowd out living: most decisions are not signals
    assert.ok(T_.signals < 0.25 * T_.decisions, `signals ${T_.signals} of ${T_.decisions} decisions`);
    // nobody keeps a positive learned value for a glyph without any credit having been paid to it
    for (const c of e.creatures) for (const [k, m] of Object.entries(c.mind.model)) if (k.startsWith('signal|')) assert.ok(m.r <= SIGNAL.creditCap + 1e-9, `${k} ${m.r}`);
    ledgerOk(e, `seed ${seed}`);
  }
});

test('conservation with crops, cooking, salvage and help over multiple seeds and a depleted-resource run', () => {
  const runs = [[3, {}], [5, {}], [9, {}], [4, { depleted: true }]];
  for (const [seed, opt] of runs) {
    const e = mk(seed);
    if (opt.depleted) for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) for (const n of e.chunk(cx, cy).nodes) if (['bush', 'deadfall'].includes(n.kind)) { e.totals.gathered[NODE_KINDS[n.kind].item] = (e.totals.gathered[NODE_KINDS[n.kind].item] ?? 0); n.units = 0; n.t = e.tick; e.chunk(cx, cy).dirty = true; e.totals.burnedNodes[NODE_KINDS[n.kind].item] = (e.totals.burnedNodes[NODE_KINDS[n.kind].item] ?? 0) + NODE_KINDS[n.kind].max; }
    e.run(2500); ledgerOk(e, `seed ${seed}`);
    for (const q of e.crops) { assert.ok(q.moisture >= 0 && q.moisture <= CROP.moistureMax); assert.ok(q.growth <= CROPS[q.kind].grow); }
    for (const s of e.shelters) { assert.ok(sum(s.store) <= e.cfg.storeCapacity); assert.ok(s.integrity >= 0 && s.integrity <= 100); }
    for (const c of e.creatures) assert.ok(e.invWeight(c) <= e.cfg.invCapacity);
  }
});

test('ground place/carry is a transfer: no repeatable acquisition reward, nothing taught to observers, predictions kept', () => {
  const e = mk(11), [a, o] = e.creatures, p = freeSpot(e, 24, 24);
  stage(e, a, { wood: 1 }); place(e, a, p.x, p.y);
  stage(e, o); place(e, o, p.x + 2, p.y); // an observer inside perception range
  const gathered0 = { ...e.totals.gathered }, rewards = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(run(e, a, { prim: 'place', item: 'wood', key: 'place|wood|ground', label: 'GATHER_WOOD' }).success, true);
    rewards.push(run(e, a, { prim: 'carry', item: 'wood', key: 'carry|wood|', label: 'GATHER_WOOD' }).reward);
  }
  assert.deepEqual(a.inventory, { wood: 1 }); assert.deepEqual(e.totals.gathered, gathered0, 'no resource entered the world');
  // only the first pickup may carry the one-off novelty bonus; repeated cycles earn nothing
  assert.ok(rewards[1] <= 0.01 && rewards[2] <= 0.01, `repeated place/carry earns no acquisition reward (${rewards})`);
  // the produced map still reaches the outcome model, so the planner predicts the inventory change...
  assert.ok(a.mind.model['carry|wood|'].produced.wood >= 1, 'inventory prediction preserved');
  // ...but the artificial outcome is never broadcast to watchers
  assert.equal(o.mind.model['carry|wood|'], undefined, 'observer learned nothing from a transfer');
  ledgerOk(e, 'carry-transfer');
});

test('sender credit is local: a settled outcome reaches the sender only through a perceived acknowledgement', () => {
  const e = mk(11), [a, b] = e.creatures, p = freeSpot(e, 28, 28);
  stage(e, a); stage(e, b); place(e, a, p.x, p.y); place(e, b, p.x + 1, p.y);
  a.relationships[b.id] = 0.5;
  const s = { id: e.nextId.signal++, tick: e.tick, from: a.id, glyph: '◇', ctx: 'none', x: p.x, y: p.y, receivers: [b.id], misheard: 0 };
  e.signals.push(s);
  a.mind.sent.push({ sig: s.id, glyph: '◇', ctx: 'none', tick: e.tick, heardBy: 1, credit: 0 });
  const watch = () => { b.signalWatch = { sig: s.id, glyph: '◇', from: a.id, until: e.tick + SIGNAL.watch, wb: e.wellbeing(b) - 1, key: 'respond|◇|unknown', cat: 'node:bush' }; };
  const rng = e.rng.next, withRng = (v, f) => { e.rng.next = () => v; try { f(); } finally { e.rng.next = rng; } };
  // 1. Sender beyond signal range: no acknowledgement is emitted and nothing is credited. The receiver
  //    still learns its own outcome.
  place(e, a, p.x + SIGNAL.range + 6, p.y); watch();
  const n0 = a.mind.total;
  e.settleWatch(b);
  assert.equal(e.totals.signalsFeedback ?? 0, 0, 'no ack emitted out of range');
  assert.equal(a.mind.total, n0, 'sender model untouched');
  assert.equal(a.mind.sent.at(-1).credit, 0);
  assert.equal(b.mind.model['respond|◇|unknown'].n, 1, 'receiver learned its own outcome');
  assert.ok(b.mind.signals['◇'].n >= 1 && (b.trust[a.id] ?? 0) > 0);
  // 2. In range but not attending: the ack is emitted (world telemetry) but unheard, so no credit.
  place(e, a, p.x + 1, p.y); watch();
  withRng(0.99, () => e.settleWatch(b));
  assert.equal(e.totals.signalsFeedback, 1, 'ack emitted');
  assert.equal(a.mind.sent.at(-1).credit, 0); assert.equal(a.mind.total, n0);
  // 3. In range, attending, glyph heard correctly: bounded credit on the sender's own model and sent history.
  watch();
  withRng(0.5, () => e.settleWatch(b));
  assert.ok(a.mind.sent.at(-1).credit > 0, `credit paid (${a.mind.sent.at(-1).credit})`);
  assert.ok(a.mind.sent.at(-1).credit <= SIGNAL.creditCap + 1e-9);
  assert.ok(a.mind.total > n0); assert.ok((a.mind.model['signal|◇|none']?.n ?? 0) >= 0.5);
  assert.equal(a.mind.heard.at(-1).from, b.id, 'the sender heard a real signal from the responder');
  // 4. A misheard acknowledgement credits only what was heard: no matching sent glyph, no credit.
  const c0 = a.mind.sent.at(-1).credit;
  watch();
  withRng(0, () => e.settleWatch(b));
  assert.notEqual(a.mind.heard.at(-1).glyph, '◇', 'ack misheard');
  assert.equal(a.mind.sent.at(-1).credit, c0, 'misheard ack cannot credit the sent glyph');
});

test('frozen mode writes no learned structures: associations, trust, strategies and models all stay empty', () => {
  const e = Expanse.create({ initialCount: 24, mode: 'frozen', learning: false, goals: true, communication: true }, { seed: 3 });
  e.run(2000);
  assert.ok(e.totals.responses > 0, 'residents still signal and respond');
  assert.equal(e.totals.signalCredit, 0);
  for (const c of e.creatures) {
    assert.equal(Object.keys(c.mind.model).length, 0); assert.equal(c.mind.total, 0);
    assert.equal(Object.keys(c.mind.goalModel).length, 0); assert.equal(Object.keys(c.trust).length, 0);
    for (const a of Object.values(c.mind.signals)) { assert.equal(a.n, 0); assert.equal(a.payoff, 0); assert.deepEqual(a.seen, {}); }
    for (const g of c.mind.goals) assert.deepEqual(g.avoid, []);
    for (const h of c.mind.goalHistory) assert.deepEqual(h.avoided, []);
  }
});

test('curiosity survives the visited-cell memory cap: a lifetime novel-cell count keeps the goal achievable', () => {
  const e = mk(11), c = e.creatures[0];
  stage(e, c); Object.assign(c, { hunger: 0, thirst: 0, energy: 100, warmth: 100 });
  c.personality.curiosity = 1; c.personality.sociability = 0;
  c.mind.visited = []; c.mind.novelCells = 0;
  for (let x = -14; x <= 20; x++) for (let y = -14; y <= -4; y++) markVisited(c.mind, x * 8, y * 8);
  assert.equal(c.mind.visited.length, LIMITS.visited, 'retained cells are capped');
  const g = updateGoals(c, e.tick, false); assert.equal(g.kind, 'curiosity');
  const m0 = goalMetric('curiosity', c);
  for (let y = 0; y <= 16; y += 8) assert.equal(markVisited(c.mind, 0, y), true, 'novel cell');
  assert.ok(goalMetric('curiosity', c) - m0 >= 0.75, 'new ground still counts at the cap');
  updateGoals(c, e.tick + 1, false);
  assert.ok(c.mind.goalHistory.some((h) => h.kind === 'curiosity' && h.how === 'achieved'), 'goal completed at full memory');
  // migrated residents without the counter get a versioned default from what they still remember
  const old = mk(12).creatures[0]; delete old.mind.novelCells; old.mind.visited = ['0,0', '1,1'];
  ensureAgency(old); assert.equal(old.mind.novelCells, 2);
});

test('share respects the recipient capacity: refused transfers keep both inventories conserved', () => {
  const e = mk(11), [a, b] = e.creatures, p = freeSpot(e, 25, 25);
  stage(e, a, { berry: 1 }); place(e, a, p.x, p.y);
  stage(e, b, { wood: 6 }); place(e, b, p.x, p.y + 1);
  assert.equal(e.invWeight(b), e.cfg.invCapacity);
  const share = e.affordances(a, e.perceive(a))(a.inventory, null).find((s) => s.prim === 'share');
  assert.ok(share, 'offered: the giver cannot see inside the recipient inventory');
  const r = run(e, a, share);
  assert.equal(r.reason, 'inventory-full'); assert.equal(r.success, false);
  assert.deepEqual(b.inventory, { wood: 6 }); assert.equal(a.inventory.berry, 1, 'giver keeps the item on refusal');
  // a capacity change during travel is caught at arrival
  const dir = [[0, 3], [3, 0], [0, -3], [-3, 0]].find(([dx, dy]) => [...Array(3)].every((_, k) => e.passable(p.x + (dx / 3) * (k + 1), p.y + (dy / 3) * (k + 1)) && !FISH_WATER.has(e.tile(p.x + (dx / 3) * (k + 1), p.y + (dy / 3) * (k + 1)))));
  assert.ok(dir, 'a passable approach exists');
  stage(e, b, {}); place(e, b, p.x + dir[0], p.y + dir[1]);
  const share2 = e.affordances(a, e.perceive(a))(a.inventory, null).find((s) => s.prim === 'share');
  let filled = false;
  const r2 = run(e, a, share2, 400, () => { if (!filled && a.act?.phase === 'travel') { stage(e, b, { wood: 6 }); filled = true; } });
  assert.ok(filled, 'recipient filled while the giver walked');
  assert.equal(r2.reason, 'inventory-full'); assert.equal(a.inventory.berry, 1); assert.deepEqual(b.inventory, { wood: 6 });
  ledgerOk(e, 'share-capacity');
});

test('a social goal persists across several interactions, not a single one', () => {
  const e = mk(11), c = e.creatures[0];
  stage(e, c); Object.assign(c, { hunger: 0, thirst: 0, energy: 90, warmth: 90 });
  c.personality.sociability = 1; c.personality.curiosity = 0;
  const g = updateGoals(c, e.tick, false); assert.equal(g.kind, 'social');
  c.relationships[99] = 0.1; // one share's worth of relationship gain
  updateGoals(c, e.tick + 1, false);
  assert.equal(c.mind.goals.find((q) => q.id === g.id)?.status, 'active', 'one interaction does not close it');
  c.relationships[99] = 0.35; // several interactions of gain
  updateGoals(c, e.tick + 2, false);
  assert.ok(c.mind.goalHistory.some((h) => h.id === g.id && h.how === 'achieved'));
});

test('determinism and exact restart with schema 5 state (goals, crops, signals)', () => {
  const a = mk(9), b = mk(9);
  a.run(900); const dir = tmp(); save(dir, a);
  const a2 = load(dir); a2.run(600); b.run(1500);
  const strip = (s) => JSON.stringify({ ...s, chunks: s.chunks.sort((x, y) => x.cx - y.cx || x.cy - y.cy) });
  assert.equal(strip(a2.toState()), strip(b.toState()));
  assert.ok(b.signals.length > 0 && b.creatures.some((c) => c.mind.goalHistory.length));
});

test('real schema-4 save migrates to 5 on a copy: identity, learned data and memories kept, original preserved, restart and rollback', () => {
  const dir = tmp(); for (const f of [SNAPSHOT, 'manifest.json']) fs.copyFileSync(path.join(V4, f), path.join(dir, f));
  const origBytes = fs.readFileSync(path.join(V4, SNAPSHOT)), orig = readState(path.join(V4, SNAPSHOT));
  assert.equal(orig.schema, 4);
  const digest = identityDigest(orig);
  const e = load(dir);
  assert.equal(e.schema, EXPANSE_SCHEMA); assert.equal(EXPANSE_SCHEMA, 5); assert.equal(e.id, orig.id); assert.equal(e.tick, orig.tick);
  const pre = path.join(dir, 'pre-migration', `schema-4-tick-${orig.tick}`, SNAPSHOT);
  assert.ok(fs.readFileSync(pre).equals(origBytes));
  const st = e.toState(); assert.equal(identityDigest(st), digest);
  for (const c of orig.creatures) {
    const m = e.getCreature(c.id);
    assert.deepEqual(m.brain, c.brain); assert.deepEqual(m.mind.model, c.mind.model); assert.deepEqual(m.mind.episodes, c.mind.episodes); assert.deepEqual(m.relationships, c.relationships); assert.deepEqual(m.mind.known, c.mind.known);
    // remembered stocks are kept exactly as last seen (possibly stale), never refreshed by the migration
    for (const s of c.mind.shelters) assert.deepEqual(m.mind.shelters.find((q) => q.id === s.id).stock, s.stock);
    assert.deepEqual(m.mind.goals, []); assert.deepEqual(m.mind.signals, {});
  }
  assert.deepEqual(st.shelters.map((s) => [s.id, s.x, s.y, s.integrity, s.store]), orig.shelters.map((s) => [s.id, s.x, s.y, s.integrity, s.store]));
  assert.ok(st.migrations.at(-1).from === 4 && st.migrations.at(-1).to === 5);
  assert.equal(migrateExpanse(structuredClone(st)).from, 5);
  ledgerOk(e, 'migrated');
  e.run(300); save(dir, e); const r1 = load(dir); r1.run(300); e.run(300);
  assert.equal(JSON.stringify(r1.toState().creatures), JSON.stringify(e.toState().creatures));
  for (let i = 0; i < 4; i++) { r1.run(10); save(dir, r1); }
  assert.ok(fs.readFileSync(pre).equals(origBytes));
  const back = tmp(); restore(path.dirname(pre), back);
  assert.ok(fs.readFileSync(path.join(back, SNAPSHOT)).equals(origBytes)); assert.equal(readState(path.join(back, SNAPSHOT)).schema, 4);
  ledgerOk(r1, 'after restart');
});

test('resource budget: per-resident agency state stays bounded and tick cost is measured', () => {
  const e = mk(3, 24); const t0 = process.hrtime.bigint(); e.run(3000); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  for (const c of e.creatures) {
    const m = c.mind;
    assert.ok(m.heard.length <= SIGNAL.heard && m.sent.length <= 6 && Object.keys(m.signals).length <= SIGNAL.associations && Object.keys(c.trust).length <= SIGNAL.trust && Object.keys(m.homes).length <= 8);
    assert.ok(JSON.stringify({ goals: m.goals, gm: m.goalModel, gh: m.goalHistory, s: m.signals, h: m.heard, t: c.trust }).length < 20000);
  }
  assert.ok(e.signals.length <= SIGNAL.ring); assert.ok(e.crops.length <= CROP.maxCrops);
  assert.ok(ms / 3000 < 20, `${(ms / 3000).toFixed(2)} ms/tick`);
});
