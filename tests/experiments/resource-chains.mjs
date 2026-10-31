// Resource-carpet diagnosis and activity-chain evidence from unattended engine runs (no injected jobs or items).
//   node tests/experiments/resource-chains.mjs --snapshot <expanse.json.gz> --ticks 3000 [--engine <repo root>] [--out f.json]
//   node tests/experiments/resource-chains.mjs --seed 7 --count 40 --ticks 4000 [--out f.json]
// --engine lets the same script drive another checkout (e.g. a worktree of the base commit) for before/after.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(arg('engine', path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..')));
const { Expanse, expectedHoldings } = await import(pathToFileURL(path.join(root, 'server/src/expanse/engine.js')).href);
const ticks = Number(arg('ticks', 3000)), every = Number(arg('every', 500));
let e, source;
if (arg('snapshot')) { e = Expanse.fromState(JSON.parse(zlib.gunzipSync(fs.readFileSync(arg('snapshot'))).toString())); source = { snapshot: path.basename(arg('snapshot')) }; }
else { const seed = Number(arg('seed', 1)); e = Expanse.create({ initialCount: Number(arg('count', 40)) }, { seed }); source = { seed, count: Number(arg('count', 40)) }; }

function census() {
  let piles = 0, pileUnits = 0, pileWood = 0, pileTiles = new Set(); const pileItems = {};
  for (const ch of e.chunks.values()) for (const p of ch.piles) { piles++; pileTiles.add(`${p.x},${p.y}`); for (const [k, v] of Object.entries(p.items)) { pileItems[k] = (pileItems[k] ?? 0) + v; pileUnits += v; if (k === 'wood') pileWood += v; } }
  let stored = 0, storedWood = 0; for (const s of e.shelters) for (const [k, v] of Object.entries(s.store ?? {})) { stored += v; if (k === 'wood') storedWood += v; }
  let carried = 0; for (const c of e.creatures) for (const v of Object.values(c.inventory)) carried += v;
  return { tick: e.tick, population: e.creatures.length, piles, pileUnits, pileWood, stored, storedWood, carried, pileItems };
}
const ledgerOk = () => { const h = e.holdings(), x = expectedHoldings(e.totals); const ks = new Set([...Object.keys(h), ...Object.keys(x)]); const bad = [...ks].filter((k) => (h[k] ?? 0) !== (x[k] ?? 0)); return { ok: !bad.length, bad }; };
const T0 = structuredClone(e.totals), start = census(), series = [start], tickMs = [];
// `chainLog` is intentionally a small in-world ring. Capture completed prepared-food evidence while the unattended
// run is progressing so a later busy settlement cannot overwrite the only real prepare events before this report.
const seenChains = new Set(), preparedFood = [], preparedOutcomes = {};
const t0 = process.hrtime.bigint();
for (let i = 0; i < ticks; i++) {
  const a = process.hrtime.bigint(); e.step(); tickMs.push(Number(process.hrtime.bigint() - a) / 1e6);
  for (const ev of e.chainLog ?? []) {
    const key = `${ev.kind}|${ev.tick}|${ev.resident}|${ev.item ?? ''}|${ev.outcome ?? ''}`;
    if (seenChains.has(key)) continue;
    seenChains.add(key);
    if (ev.kind === 'food' && ev.cooked && ev.stages?.includes('prepare:cook')) {
      preparedOutcomes[ev.outcome] = (preparedOutcomes[ev.outcome] ?? 0) + 1;
      if (preparedFood.length < 8) preparedFood.push(structuredClone(ev));
    }
  }
  if ((i + 1) % every === 0) series.push(census());
}
const wall = Number(process.hrtime.bigint() - t0) / 1e6;
const delta = (k) => { const out = {}; for (const [it, v] of Object.entries(e.totals[k] ?? {})) { const d = v - (T0[k]?.[it] ?? 0); if (d) out[it] = d; } return out; };
tickMs.sort((a, b) => a - b);
const q = (p) => Math.round(tickMs[Math.min(tickMs.length - 1, Math.floor(p * tickMs.length))] * 100) / 100;
const end = census();
const chains = e.totals.chains ?? null, log = e.chainLog ?? [];
const durations = (kind) => { const d = log.filter((x) => x.kind === kind).map((x) => x.ticks).sort((a, b) => a - b); return d.length ? { n: d.length, median: d[d.length >> 1], p90: d[Math.floor(d.length * 0.9)] } : { n: 0 }; };
const report = {
  engine: arg('engine') ? 'external checkout (--engine)' : 'this checkout', source, ticks, startTick: start.tick, endTick: end.tick,
  start: { ...start, pileItems: undefined }, end: { ...end },
  growthPer1000: { piles: Math.round((end.piles - start.piles) / ticks * 1000 * 10) / 10, pileUnits: Math.round((end.pileUnits - start.pileUnits) / ticks * 1000 * 10) / 10, pileWood: Math.round((end.pileWood - start.pileWood) / ticks * 1000 * 10) / 10 },
  produced: { gathered: delta('gathered'), crafted: delta('crafted') },
  consumed: { built: delta('built'), repaired: delta('repaired'), burned: delta('burnedItems'), wornOut: delta('wornOut'), mendUsed: delta('mendUsed'), craftUsed: delta('craftUsed'), eaten: delta('eaten') },
  movement: { placed: delta('placed'), hauled: delta('hauled'), deposited: delta('deposited'), retrieved: delta('retrieved') },
  gatherDemand: e.totals.demandGathers !== undefined ? { demand: e.totals.demandGathers - (T0.demandGathers ?? 0), surplus: e.totals.surplusGathers - (T0.surplusGathers ?? 0) } : null,
  chains, preparedFood: { completed: Object.values(preparedOutcomes).reduce((n, q) => n + q, 0), byOutcome: preparedOutcomes, examples: preparedFood }, chainDurations: chains ? { materials: durations('materials'), food: durations('food'), explore: durations('explore') } : null,
  chainExamples: chains ? ['materials', 'food', 'explore'].map((k) => log.filter((x) => x.kind === k).slice(-2)).flat() : null,
  replans: e.totals.replans ?? null, births: e.totals.births - T0.births, deaths: e.totals.deaths - T0.deaths, deathsByCause: delta('deathsByCause'),
  ledger: ledgerOk(), perf: { msPerTickMean: Math.round(wall / ticks * 100) / 100, p50: q(0.5), p95: q(0.95), max: q(1), rssMB: Math.round(process.memoryUsage().rss / 1048576), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576) },
  series: series.map((s) => ({ tick: s.tick, population: s.population, piles: s.piles, pileUnits: s.pileUnits, pileWood: s.pileWood, stored: s.stored, carried: s.carried })),
};
const out = arg('out'); if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 1)); }
console.log(JSON.stringify({ source, growthPer1000: report.growthPer1000, start: report.start.piles, end: end.piles, gatherDemand: report.gatherDemand, chains: chains && { m: chains.materials.completed, f: chains.food.completed, x: chains.explore }, ledger: report.ledger.ok, perf: report.perf, pop: [start.population, end.population] }));
