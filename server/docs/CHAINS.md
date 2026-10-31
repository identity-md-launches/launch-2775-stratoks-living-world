# Resource demand, connected activity chains and decision evidence (schema 5, additive)

Code: `server/src/expanse/chains.js` (new), hooks in `server/src/expanse/engine.js`, view fields in
`server/src/expanse/view.js`, renderer helper `shared/stockpiles.js`. The save format stays **schema 5**: new fields are
additive and defaulted on load (`ensureChains`, `ensureWorldChains`), so no migration is run and no stock, resident,
memory or learned weight is touched. An older server ignores the extra fields.

## What changed in the simulation (designed rules, all accounted)

| Rule | Before | Now |
|---|---|---|
| `place` (fuel on ground) | always offered for any held fuel, onto the resident's current tile | offered only with a felt fire demand (warmth < 70, perceived temperature < 8 °C, or hungry while holding heatable raw food) or onto a pile already here; if a pile is perceived within 2 tiles the resident walks onto it, so fuel is consolidated instead of scattered |
| `carry` (pick up) | only from a pile on the resident's own tile, never as a first step after something else | additionally a **haul** step to a perceived pile ≤2 tiles away when its material has a visible use or a remembered store has room |
| `deposit` | to the nearest known store | to the nearest known store **not remembered as full** (memory may be stale; a full store still fails honestly) |
| acquisition drive (`0.12 × items` in the step reward) | every produced unit | only units with a perceived use: materials named by the resident's own demand at decision time, food while not sated or carrying ≤3, fuel under fire demand, a tool not already held |
| need bias for gathering/retrieving materials | warmth-only | +0.35..+1.35 when demanded; −0.5 for surplus while warm and without fire demand |
| tools | only `fish_line` wore out (6 uses) | `hand_axe` wears per tool-gather (40 uses), `stone_club` per armed attack (20); worn-out tools leave the inventory (`totals.wornOut`) |
| `mend` (new primitive) | – | 5 ticks, 1 energy, consumes 1 flint (hand axe) / 1 fiber (fishing line) and halves the tool's wear; ledger term `totals.mendUsed` |
| explore | random unvisited direction | plus a **search** variant when the resident is hungry and knows no food source, or has a material demand with no known source; once found, `move home` is offered from 3 tiles and preferred |
| interruption | danger, thirst, hunger | plus `repair-done` (target repaired by someone else while travelling), `site-finished`, `found` (search succeeded) |

`expectedHoldings()` now subtracts `mendUsed`. Every other new counter (`placed`, `hauled`, `chains`, `replans`,
`demandGathers`, `surplusGathers`) is evidence only.

Material demand (`materialDemand`) is derived **only** from the resident's observation and memory: missing materials
of perceived unfinished sites, needs of perceived or remembered worn shelters (< 70 integrity, ≤16 tiles) and the
mend material of its own tools worn ≥ 50 %. Materials it already holds ≥ 4 of are not demanded.

## Chains (observer evidence; nothing is assigned)

Recorded from completed steps in `onStep` / `trackSearch`; bounded per resident and per world.

* **materials** – acquire (`gather` / `carry` / `salvage`) → optional store (`deposit`) / `retrieve` → use
  (`build`, `repair`, `repair-help`, `mend:<tool>`). Log entry: item, stages, whether it passed through a store,
  Chebyshev distance from acquisition to use, ticks.
* **food** – acquire (`gather`, `gather:fish`, `harvest`, `retrieve`) → optional prepare (`cook`) → `eaten` /
  `shared` / `provisioned` / `stored`. Entry has hunger at start/end, remembered home food stock, recipient.
* **explore** – `search` for `food` or a material → `found` (resident perceives a source) → `returned` (≤3 tiles of
  home) or `settled` (completes a shelter > 8 tiles from its former home), or `failed` after 900 ticks unfound /
  1800 ticks total.

Bounds (`CHAIN_LIMITS`): 6 decision records, 3 alternatives each, 6 provenance kinds, 6 stages, 300-entry world
`chainLog`. Per-tick work is still bounded by `maxDecisionsPerTick`.

## Interface for integration (read-only additions)

* `frame().residents[i].goal` – active goal kind; `.chain` – `{kind, stage, item}` from real state or `null`.
  Activity `state` may now also be `haul`, `mend`, `search`, `return` (renderers should fall back to `travel` /
  `craft` for unknown states).
* `frame().chains` – `{ totals, replans, recent: last 40 chainLog entries }`.
* `frame().inspector.decisions` – per decision: tick, plan id, source, goal, chosen step keys, utility, top-3
  alternatives with utilities, needs, perception counts, demand (`item → reason`), food held/stored, search state,
  and `interrupted: {tick, why}` when replanned.
* `frame().inspector.chains` – materials in hand with provenance, current food chain, search, completed counts,
  tool wear `{used, uses}`.
* `view.piles[i].size` – size class 0–4 from the exact quantity (`pileSizeClass`).
* `view.pileClusters` – `{v, cell: 4, clusters: [{key, cell, x, y, units, items, members: [{id, x, y, units}]}]}`
  for zoomed-out rendering; quantities are exact and every member is selectable. `shared/stockpiles.js` exports
  `aggregatePiles(piles, cell)` so the browser can aggregate at other zoom cells (1/2/4/8).

The web renderer is not changed by this component (web/ is outside its scope). Until integration, the existing
client keeps drawing one sprite per pile; the server-side fix already reduces the number of piles.
