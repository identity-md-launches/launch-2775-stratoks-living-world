# STRATOKS world repair revision — 2026-10-31

The three reopened findings reproduce and are fixed in the renderer. This is a revision of accepted commit `09c8842bab938747af52bdb603a73a1c21bae909` (see `source-audit.json` for the full hash), on the supplied STRATOKS base `d0ee752960b66ac04c8f36964e195d9409d97bfb`. No merge/reclone, production deployment, reseed, schema migration, dependency change or wallet implementation change was performed. The source and relative-URL production export are delivered together. This report records worker observations, not independent certification.

| Finding | Reproduction | Correction and evidence |
| --- | --- | --- |
| `acf64fa…` — fabricated mallet | Restore the unchanged agency checkpoint, advance four ordinary ticks, query `(-23,-23,94,94)`. Vizigu #100 is at `(58,61)`, gather/gather, wood, progress 0.17, target `(57,60)`, carrying `{}`, tools `[]`. The inherited mapping selects `pickup` and `build.lower / build.ready / build.lower`. | `appearance.ts:34` returns `work` without a confirmed compatible tool. The existing target-directed hand gesture and separate actual inventory remain. Mallet-bearing pickup mapping removed. `checkpointAppearance.test.ts` reproduces the actual state; `appearance.test.ts` checks all directions/phases and wood/stick node types. |
| `2a14e2a…` — straight terrain toe/bands | The inherited `surfaceGeometry` has four top vertices and straight quadrilateral faces. Browser captures at the reported highlands/coast/island locations show long straight toes and narrow repeated facets. | `contours.ts` creates joined sampled cubic boundaries; `surface.ts:10` uses them for tops, faces and toes, and `pickSurface` uses those same polygons. `ground.ts` draws broad rock masses keyed along the run. Shared-edge, lower-toe, corner, streaming-overlap, negative-coordinate, immutability and 720 projection cases pass. A separate brute-force painter-order scan agrees with bounded picking at 14,688 points (`picking-audit.json`). |
| `a481a91e…` — overview log carpet | The exact query contains 956 piles and 307 four-tile clusters, but the inherited renderer draws each pile and store at every zoom. These are real ground holdings, not duplicated frame entries. | `resources.ts` groups by projected scale while retaining every original member and exact inventory. Groups separate storage kind, ruined state, terrain, biome and wood-bearing/stone-bearing/other material families. Mixed piles retain all secondary items. Anchors are real members. `worldRenderer.ts` draws quantity classes and storage bins; `Map.tsx`/`ResourceEvidence.tsx` expose pointer and keyboard selection with every member's id, coordinates and items. No per-marker numeric badges overlap the world. |

The accounting/rendering boundary matters: `server/src/expanse/view.js:40` copies exact piles/stores and supplies aggregation membership. `shared/stockpiles.js` sums quantities; it does not consume them. This revision changes only their presentation. The engine's production, transfers, demand, consumption and persistence remain unchanged. The existing long-run accounting/chain tests ran as part of the full suite. The inherited fuel-affordance failure below remains explicitly unresolved; no stock was hidden, deleted or assigned elsewhere to disguise it.

## Exact stock density

Counts are strictly in-canvas wood-bearing ground/store anchors at tick 12604, camera `(24,24)`, using the same reported query and projection. They count stock markers, not natural deadfall nodes or residents carrying wood. Exact membership and totals are conserved at every level; marker counts are not stock counts. Raw measurements: [`density.json`](density.json).

| Canvas | Span | Cell | Individual anchors before | Group anchors after |
| --- | ---: | ---: | ---: | ---: |
| 1440×764 | 22 | 4 | 122 | 52 |
| 1440×764 | 41.7251 | 8 | 420 | 86 |
| 390×706 | 9.5 | 8 | 80 | 13 |
| 390×706 | 18.2879 | 16 | 205 | 18 |

Close desktop zoom still shows individual quantity-aware piles. Small phone projections group even at close zoom; exact member selection remains available in the resource dialog and tile inspector. Natural resource nodes remain at their real positions and can still use their original illustrated wood art.

## Browser comparisons and interactions

All comparisons use the real isolated browser engine restored from the supplied public **fixture**, paused after four ordinary ticks. No action, prop, inventory, resource or resident position was assigned. Both widths report the same Vizigu state at tick 12604. Screenshot metadata and assertions are in [`browser-results.json`](browser-results.json); the short method is in [`browser-reproduction.txt`](browser-reproduction.txt).

| Scene | Desktop before / after (1440×900) | Phone before / after (390×844) |
| --- | --- | --- |
| Initial settlement | [Before](before-desktop-settlement.jpg) / [After](after-desktop-settlement.jpg) | [Before](before-mobile-settlement.jpg) / [After](after-mobile-settlement.jpg) |
| Furthest zoom | [Before](before-desktop-overview.jpg) / [After](after-desktop-overview.jpg) | [Before](before-mobile-overview.jpg) / [After](after-mobile-overview.jpg) |
| Cold highlands near `(26,-50)` | [Before](before-desktop-cold.jpg) / [After](after-desktop-cold.jpg) | [Before](before-mobile-cold.jpg) / [After](after-mobile-cold.jpg) |
| Coast near `(-40,23)` | [Before](before-desktop-coast.jpg) / [After](after-desktop-coast.jpg) | [Before](before-mobile-coast.jpg) / [After](after-mobile-coast.jpg) |
| Islands near `(-60,80)` | [Before](before-desktop-islands.jpg) / [After](after-desktop-islands.jpg) | [Before](before-mobile-islands.jpg) / [After](after-mobile-islands.jpg) |
| Vizigu, close zoom, actual empty hands | [Before](before-desktop-barehand.jpg) / [After](after-desktop-barehand.jpg) | [Before](before-mobile-barehand.jpg) / [After](after-mobile-barehand.jpg) |

Resource disclosure: [desktop](after-desktop-resources.jpg), [phone](after-mobile-resources.jpg). [320×568 first screen](after-320-first-screen.jpg).

Chromium checks pass: search #100, open inspector, follow, zoom to both limits, reset camera, navigate the atlas, keyboard pan/Enter terrain inspection, keyboard-open resource list, click a real stock marker, compare all displayed member quantities against the actual received frame, Escape/focus return, and scrolling a long resource group while keeping Close reachable at 320×568. No page errors or failed local assets were observed. The initial 390 screen exposes the world and Find residents, with camera, resource and wallet controls available. Frames remain streamed; neither preview nor evidence substitutes a screenshot for the world.

## Commands and results

Existing `web/package.json`, `web/package-lock.json`, TypeScript and Vite configuration are unchanged. Dependencies were installed from that lockfile into a temporary copy outside the repository; no repository `node_modules` was written. README install/preview/rebuild commands remain applicable. Actual worker commands:

```sh
# web/, server/ and shared/ copied into /tmp/stratoks-revision first
npm ci --prefix /tmp/stratoks-revision/web --cache /tmp/stratoks-npm-cache --no-audit --no-fund
npm run typecheck --prefix /tmp/stratoks-revision/web
npm run build --prefix /tmp/stratoks-revision/web
# Production output copied back as a complete dist/ export, removing stale bundles.
/tmp/stratoks-revision/web/node_modules/.bin/tsx --test web/src/*.test.ts web/src/expanse/*.test.ts
node --test --test-concurrency=2 tests/*.test.js
node --test tests/expanse-auth-client.test.js tests/expanse-auth.test.js
node --test --test-name-pattern='fuel placement' /tmp/stratoks-base-review/tests/chains.test.js
PLAYWRIGHT_BROWSERS_PATH=/tmp/stratoks-browsers node tests/browser/visitor-recovery.mjs /tmp/stratoks-revision/web/node_modules/playwright/index.mjs test/scratch/revision/wallet
IMD_PLAYWRIGHT=/tmp/stratoks-revision/web/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/stratoks-browsers node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline
```

| Check | Actual result |
| --- | --- |
| TypeScript / production build | Passed. [Typecheck](typecheck.txt), [build](build.txt). The inherited `node:fs` browser-externalization warning from config remains; no runtime import failure was observed. |
| Frontend tests, including new exact-checkpoint/contour/accounting cases | **63/63 passed**. [Raw log](frontend-tests.tap). |
| Final focused tests after contour cache reuse correction | **18/18 passed**. [Raw log](final-focused-tests.tap). |
| Full existing backend suite | **256/258 passed** in 766.3 seconds. [Full log](backend-tests.tap). Both original failures are retained below. |
| Isolated auth/controller retest | **42/42 passed**, including the late-logout case that failed in the concurrent run. [Raw log](auth-retest.tap). |
| Existing actual-HUD wallet recovery script | **16/16 scenarios passed**, no browser errors. [Results](wallet-regressions.json). Simulated EIP-6963/1193 providers, real disposable EOA signatures and local HTTP verification; no real extension, phone wallet or production credential. |
| Final pinned design probe | **16/16 passed** at 320, 390 and 1440 widths plus reduced motion. [Probe](taste.json). |

The two backend-run failures were outside changed code:

1. `tests/chains.test.js:110`, “fuel goes onto the existing pile, not a new tile”: `place` is absent. The same test **fails in a separate archive of accepted HEAD**, with no revision files present ([baseline log](baseline-confirmed.tap)). This revision leaves that engine behavior and the test unchanged.
2. `tests/expanse-auth-client.test.js:256`, late logout: `connected` rather than `verified`. It **passes in the isolated 42-test auth rerun**. The fixture uses a 500ms request deadline, so contention is a plausible explanation, not an established root cause. No wallet code was changed; the concurrent failure remains in the record.

The complete suite also passed the representative schema-5 300+ resident fixture preservation/restart case, long-run conservation across seeds, unattended chain completion, real schema migration on copies, and deterministic continuation. Those existing tests exercise the unchanged engine; this revision makes no new behavioral-emergence claim beyond their results.

## Better Interface review

Applied the pinned six-domain guide while implementing the affected surfaces, then checked the production export. Guidance attribution and licenses remain in the existing documentation. `DESIGN.md` records the final tokens, controls, typography, grouping policy and responsive behavior.

| Domain | Coverage, finding and correction | Limits |
| --- | --- | --- |
| Accessibility | Native dialog/list/button semantics; labeled 44px resource control; keyboard opening, Escape, focus restoration, canvas alternative, fixed Close header and reduced-motion captures. Long mobile member lists scroll inside the dialog. | No screen-reader session, physical touch device or forced-colors session. |
| Layout | World remains first; inspected 1440×900, 390×844 and 320×568. Resource inventory is disclosed on request rather than hundreds of overlapping badges. No horizontal overflow or covered primary controls in checks. | Native 200% browser zoom and RTL localization were not tested. |
| Writing | Exact inventories, group/member distinction, marker location and received tick are stated from real state. No fabricated thoughts, tools or stock. Changed-group and empty-view messages explain the state and next action. | Other historical documentation/UI copy was not comprehensively re-reviewed. |
| Typography | Existing local Manrope and six-step scale retained; numeric inventories use tabular figures; item names/ids wrap. The probe passes sizes/families/weights/tracking. | Canvas artwork is not machine-readable text. |
| Colors | Existing HUD/background/text/gold tokens reused. The probe passes its rendered solid-background text pairs. No new palette or semantic tokens. | Canvas/image and alpha-composited artwork contrast is not certified. |
| UI details | Existing icon set, hover/focus states, native modal and motion preference retained. The first probe found `living.css`'s `.exp-context` border plus shadow; removed only its redundant shadow, then re-ran to 16/16. | WebKit installed but could not launch: host libraries including `libgtk-4.so.1` and `libpangocairo-1.0.so.0` are unavailable. Safari remains unverified. No animation-panel slow-motion audit. |

## Preservation, setup and rollback

`server/`, `shared/`, existing `tests/`, `web/public/`, `web/art-source/`, manifests, lockfiles and build configuration are byte-unchanged against accepted HEAD. Thus world identity, learned weights, memories, visitors, inventories, art sources/licenses, atlas manifests and checkpoints are retained. No migration is required or performed. The existing owner-run backend package and its setup/backup/rollback guidance remain in [README](../../README.md) and [backend documentation](../../docs/living/BACKEND.md).

Serve the complete `dist/` directory at a static subpath; all exported asset URLs remain relative. Anonymous isolated demo viewing works without credentials. For an owner backend, retain the existing configuration/authentication setup; this revision does not deploy it. Roll back the **whole static export plus matching frontend source** to the accepted version if needed; keep backend state and backups untouched. Do not regenerate the checkpoint or overwrite an owner's world.

Complete for the three-finding rendering revision. Remaining limits are the inherited fuel-affordance failure, the concurrent auth-test failure that passed alone, WebKit/physical-wallet/device/accessibility checks noted above, and the existing behavior-research limitations in prior validation. The underlying geological bands/topology remain authoritative; their displayed boundaries are now curved. Rendering performance and delivery integrity are recorded below.


## Rendering measurements

Headless Chromium, DPR 1, sequential pages, actual restored engine paused, six scenes per export. Each scene samples browser animation callbacks for 5.6 seconds and reads the renderer’s rolling 120-draw trace. These are measured draw times, **not an FPS promise**. The renderer caps visual updates at 30 Hz; animation callback frequency is a separate metric. [Raw distributions and memory readings](performance.json).

| Width / scene | Before median / p95 (ms) | After median / p95 (ms) |
| --- | ---: | ---: |
| 1440 / settlement | 7.2 / 11.3 | 6.4 / 11.5 |
| 1440 / overview | 21.3 / 57.4 | 13.9 / 33.6 |
| 1440 / cold | 11.0 / 24.6 | 23.2 / 28.5 |
| 390 / settlement | 2.2 / 5.1 | 1.6 / 3.7 |
| 390 / overview | 5.7 / 12.5 | 3.8 / 7.0 |
| 390 / cold | 5.4 / 7.4 | 1.2 / 2.2 |

Reported main-page JavaScript heap was approximately 27.6–29.4 MB after the change; this browser estimate excludes workers, native canvas backing stores and GPU allocation. The cache is bounded to one DPR≤2 viewport plus 384 cliff rasters of 128×160 RGBA pixels (30 MiB maximum raster backing), with at most 384 fast lookup keys. Identical terrain signatures reuse the contour mesh across polling frames. The largest draw sample in this run was 52.9 ms. The desktop highlands remain the heaviest scene and can stutter around streaming/camera changes; the results do not establish a hardware-independent frame rate. Timings vary across runs and this revision does not conceal the heavier contour/cache memory footprint.

A separate short engine measurement restored the existing **synthetic schema-5 fixture with 324 residents**, advanced 20 ordinary ticks and checked the exact ledger afterwards. Mean/median/p95 were 89.6/72.7/218.0 ms per tick; zero item-ledger discrepancies. Process RSS after this short run was 353.4 MB and heap used 159.3 MB. This is a short local timing sample, not a long-run capacity claim; [raw samples](tick-benchmark.json).

## Delivery audit

The complete static export contains 27 files (5,965,375 bytes). Stale generated JS/CSS bundles were removed; source assets, licenses, checkpoint, existing manifests and lockfile remain. The revision's conservative complete-file addition bound, including a 64 KiB allowance for this final audit/documentation, is **2,764,269 bytes**, below 8,388,608. Evidence stays within its explicit 3 MiB `.gitignore` path budget. No dependency/cache directory, package archive, submodule or prohibited file was added/changed. [File budget](delivery-audit.json), [source/export SHA-256 manifest](source-audit.json), [finding responses](../../.imd-responses.json).
