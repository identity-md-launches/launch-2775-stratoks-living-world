// Schema 5 designed physics: material/object capabilities and action preconditions, effects and costs.
// DESIGNED (not learned): these tables. Residents are NOT given them. Affordances only offer generic primitives
// (plant a held item here, tend a perceived crop, harvest a perceived ripe crop, use a held item on a fire, ...);
// whether a primitive works, and what it produces, is learned from outcomes by the per-resident outcome model.
// A capability says what kind of primitive may be attempted with a thing; it never reveals the result.
import { T, CLIMATE } from './terrain.js';

// Per-material capabilities. `edible` = hunger relief, `thirst` = thirst relief, `fuel` = heat units when burned,
// `plantable` = can be put into soil (outcome depends on CROPS), `heatable` = may be held over a fire (outcome
// depends on COOKING). New materials participate by declaring properties here, not with bespoke behaviour.
export const MATERIALS = {
  berry: { edible: 20, plantable: true, heatable: true, storable: true },
  cooked_berry: { edible: 28, storable: true },
  shellfish: { edible: 26, heatable: true, storable: true },
  cactus_fruit: { edible: 10, thirst: 22, plantable: true, storable: true },
  lichen: { edible: 8, heatable: true, storable: true },
  fish: { edible: 30, heatable: true, storable: true },
  cooked_fish: { edible: 44, storable: true },
  cooked_shellfish: { edible: 36, storable: true },
  cooked_lichen: { edible: 16, storable: true },
  wood: { fuel: 6, building: true, storable: true },
  stick: { fuel: 2, building: true, storable: true },
  fiber: { fuel: 1, building: true, storable: true },
  bundle: { fuel: 4 },
  stone: { building: true, storable: true },
  flint: { storable: true },
};
export const cap = (item, prop) => MATERIALS[item]?.[prop];

// Cooking (designed): holding a heatable raw food over a lit fire for `ticks` turns it into the listed result and
// burns `heat` fuel units from that fire. Items are conserved 1:1 (raw -> cooked); the fuel decrease is heat.
// Heatable foods without an entry only scorch: the item is kept and the fire still loses heat.
export const COOKING = { berry: 'cooked_berry', fish: 'cooked_fish', shellfish: 'cooked_shellfish', lichen: 'cooked_lichen' };
export const COOK = { ticks: 6, heat: 1.5, minFuel: 1.5, energy: 0.4 };

// Crops (designed): soil tiles, temperature window (biome base temperature, deg C), water, growth and yield.
// Checked every `CROP.every` ticks. A check grows the crop only if it has moisture and the climate fits;
// otherwise it counts as a stress check, and `withers` stress checks in a row kill the crop (seed lost).
export const CROPS = {
  berry: { soil: [T.GRASS, T.FOREST], minTemp: 5, maxTemp: 26, grow: 6, yield: 3, withers: 4 },
  cactus_fruit: { soil: [T.SAND, T.DUNE], minTemp: 14, maxTemp: 45, grow: 8, yield: 2, withers: 8 },
};
export const CROP = { every: 50, moistureMax: 4, tendGain: 2, tendTicks: 4, tendEnergy: 0.4, tendWaterReach: 4, naturalWaterReach: 1, plantTicks: 3, plantEnergy: 0.5, harvestTicks: 4, harvestEnergy: 0.6, maxCrops: 600 };
export function cropTemp(biome, tile) { const c = CLIMATE[biome] ?? CLIMATE.temperate; return c.t + (tile === T.SNOW ? -3 : 0); }

// Action table: reach (tiles), duration (ticks), energy, and the generic preconditions each primitive checks at
// execution time. The engine's perform* methods implement the effects; this table is the single place the
// costs live so that new objects can reuse the same primitives.
export const ACTIONS = {
  inspect: { reach: 1, ticks: 1, energy: 0 },
  move: { reach: 0 },
  gather: { reach: 1, ticks: 6, energy: 1.2 },
  carry: { reach: 0, ticks: 1, energy: 0 },
  place: { reach: 0, ticks: 2, energy: 0 },
  combine: { reach: 0, ticks: 4, energy: 1 },
  use: { reach: 1, ticks: 2, energy: 0 },
  plant: { reach: 0, ticks: CROP.plantTicks, energy: CROP.plantEnergy, requires: ['held:plantable', 'tile:open-soil'] },
  tend: { reach: 1, ticks: CROP.tendTicks, energy: CROP.tendEnergy, requires: ['crop:growing', 'water:near-crop'] },
  harvest: { reach: 1, ticks: CROP.harvestTicks, energy: CROP.harvestEnergy, requires: ['crop:ripe', 'inventory:space'] },
  cook: { reach: 1, ticks: COOK.ticks, energy: COOK.energy, requires: ['held:heatable', 'fire:fuel'] },
  repair: { reach: 1, ticks: 6, energy: 1, requires: ['shelter:finished', 'held:building-material'] },
  deposit: { reach: 1, ticks: 2, energy: 0, requires: ['shelter:standing'] },
  retrieve: { reach: 1, ticks: 2, energy: 0, requires: ['shelter:standing', 'inventory:space'] },
  salvage: { reach: 1, ticks: 4, energy: 0.6, requires: ['shelter:ruined', 'inventory:space'] },
  share: { reach: 1, ticks: 1, energy: 0 },
  signal: { reach: 0, ticks: 1, energy: 0.05 },
};

// Neutral signal glyphs. They carry no built-in meaning; see agency.js for how associations are learned.
export const GLYPHS = ['◇', '△', '○', '□', '☆', '◁'];
