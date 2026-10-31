# Validation · Stratoks browser/service integration

**Historical Phase 1/client-repair record.** The former `artifacts/phase-1.1/` evidence bundle is not included in this tree. Current living-world accounting and activity-chain evidence is in [chains/VALIDATION.md](chains/VALIDATION.md); claims and tool versions below describe the earlier client run.

Date: 26 October 2026. These are reproducible worker-side observations, not independent certification. The assignment’s verifier checks paths and bytes, not behavior.

## Revision: four reproduced client findings

Complete for the stated revision scope. All four reports reproduced against the original committed export before source edits. Responses are in root `.imd-responses.json`. Only the affected client behavior, its export, regression checks and documentation changed; the accepted simulation/service implementation and dependencies were retained.

Current evidence is archived in [revision/](revision/): `before.json`, `checks.json`, `browser-checks.json`, `interface-checks.json`, `taste.json` and six real production-browser screenshots. `checks.json` records **22 passing checks**, **57 layout measurements** and no uncaught application errors. Node **v24.22.1**, Playwright Chromium **156.0.8078.4**, local x64 Linux; viewport emulation is not physical-device testing. The visitor tests sign a real EIP-191 challenge with an ephemeral generated test wallet and use the delivered HTTP service with manual simulation ticks. No capacity response is mocked. The 30-second browser refresh is advanced with Playwright's virtual clock; this is not a real-time soak.

| Finding | Reproduction before editing | Fix and final evidence |
|---|---|---|
| `1e8ca2…3517` · high, landscape toolbar | At 667×375, app/document height 560px, CTA y=347.375–393.375, footer y=460–560 | `web/src/styles.css:118` removes fixed minima; `:1882` compacts short-height chrome/welcome and keeps panels scrolling. Final app/document 375px, CTA y=140–186, footer y=295–375. All five toolbar actions work at eight tested viewports; landscape panel scroll and inspector tested. |
| `bf18fc…9fdc` · connection notice/copy | At 390×844 with an unavailable local URL, notice y=76–130 covered heading y=82–144; empty world ID still said the last view was frozen | `web/src/App.tsx:47`, `web/src/styles.css:125` reserve the actual notice height plus 12px; `web/src/service.ts:218` chooses initial-failure text unless a world snapshot exists. At 390, heading now y=148–210 below notice y=76–130. Five failure viewports pass; real snapshot loss retains frozen wording, metrics remain below the title, and reconnect removes reserved space. |
| `635fcf…ff60` · rejected visitor presence | Actual 64-visitor world returned HTTP 200 `{ "ok": false }`, authenticated address absent, UI announced success and enabled Leave food | `web/src/App.tsx:825` checks both action-time and timed presence responses, clears stale success and disables actions on rejection. Actual service rejects initial placement, a gift's preflight and a 30-second refresh. No `/api/visitor/action` request follows rejection. Freeing a slot and explicitly retrying restores placement and a real food gift. |
| `810454…42ce6` · inspector learning load | With `world.learning=true`, holding detail HTTP responses showed “Learning disabled for this world” | `web/src/Panels.tsx:389` uses the snapshot flag. Enabled/disabled worlds each report their actual status while details are held; statistics remain dashes and visitor memories say Loading. Released details populate statistics without changing the enabled-world statement. |

### Revision commands actually run

| Command | Outcome |
|---|---|
| `node web/scripts/task.mjs build` | Exit 0; final relative-URL production export in `dist/` |
| `node web/scripts/task.mjs typecheck` | Exit 0, `tsc --noEmit` |
| `node web/scripts/task.mjs test` | Exit 0, 7/7 protocol tests |
| `node --test tests/*.test.js` | Exit 0, 23/23 service/simulation/authentication/persistence tests |
| `node web/scripts/check-revision.mjs` | Exit 0, 22 Chromium checks, 57 recorded geometries; default output `artifacts/revision/` archived here under `docs/revision/` |
| `node web/scripts/check-browser.mjs` | Exit 0, 20 existing Chromium integration checks; two real clients, wallet authentication, interventions, reconnect and reset |
| `node web/scripts/check-interface.mjs` | Exit 0, 9 existing interface checks; seven axe states without violations and eight rendered text/background pairs above 4.5:1 |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Exit 0, 16/16 checks at 320/390/1440; `IMD_PLAYWRIGHT` and `PLAYWRIGHT_BROWSERS_PATH` pointed to the temporary install |

Dependencies, runtime downloads and service test data were kept under `/tmp`. The new script accepts an output-directory argument, e.g. `node web/scripts/check-revision.mjs /tmp/stratoks-revision-checks`. The build still reports the existing transitive `ox`/`node:worker_threads` externalization warning. No uncaught runtime errors were observed in the checked browser flows.

### Better Interface review of the revised surfaces

| Domain | Coverage and result | Limits |
|---|---|---|
| Accessibility | Checked native controls, disabled visitor actions, existing alert/status semantics, focus/escape paths, internal panel scroll, existing dialog/reduced-motion flows and eight combined axe states; no violations in the scans | No screen reader, native 200% zoom, or physical keyboard/device session |
| Layout | Checked fresh preview, demo, every dock panel, connection failure, reconnect and delayed inspector at 320×700, 360×540, 390×844, 568×320, 667×375, 844×390, 768×1024, 1440×1000 as applicable; all app heights equal viewport, no document overflow, toolbar reachable | RTL, localized copy, virtual phone keyboard and safe-area hardware untested |
| Writing | Checked failure/retained-view distinction, capacity recovery, successful retry and world-level learning truth before details; all four false/misleading states corrected | English only; template speech was unchanged |
| Typography | Checked final screenshots and six existing size tokens; local font resolves, status/capacity copy wraps, intro decoration removes cleanly at short heights; probe passes | Non-Latin and native text enlargement untested |
| Colors | Existing palette retained; interface script remeasured eight actual rendered pairs, all above 4.5:1; opaque notice and panel surfaces inspected in screenshots | No claim about every canvas pixel, wallet icon or third-party prompt |
| UI | Checked pending/success/error/retry/loading states, all toolbar actions, capacity guards, scene-to-panel transitions and automatic reconnect; final screenshots inspected | Animation-panel slow replay and real wallet apps/passkeys untested |

The assigned browser tool also reproduced the original 667×375 geometry, then inspected the final landscape preview and 390px connection failure. Final captures `preview-390.png`, `landscape-preview-667.png`, `landscape-residents-667.png`, `connection-failure-390.png`, `learning-loading-390.png` and `visitor-capacity-390.png` are in `docs/revision/`. The first 390px screen shows the product, connection status, Connect and Explore local demo.

**Limitations:** WebKit launch was attempted again and refused because required host libraries (including GTK/GStreamer) are missing. No Safari, ARM64, Docker, real VPS, public TLS/WSS, physical wallet or deployment checks are claimed. Performance/learning comparison data below belong to the earlier accepted delivery; these client corrections did not rerun those experiments or establish a new capacity. Publication URL/final commit remain assigned by IMD after capture; publishing the static client does not install the service.

The sections below preserve the earlier accepted delivery's evidence and operating boundaries.

## Result at a glance

| Area | Result |
|---|---|
| Usable client and supplied simulation protocol | Implemented; production export exercised with private demo and real local service |
| First screen at 390px | Product, status, Connect and **Explore local demo** visible without scrolling |
| Production build / TypeScript | Passed |
| Server tests | 23 passed, 0 failed |
| Client protocol tests | 7 passed, 0 failed |
| Chromium service/browser integration | 20 checks passed, including two real browser clients |
| Rendered interface checks | 9 checks passed; eight measured contrast pairs |
| Automated accessibility | No axe WCAG A/AA violations in eight inspected states across both browser scripts |
| Pinned taste@1 | 16/16 passed at 320, 390 and 1440px |
| Share metadata/assets | Title, description, favicon, og:title and actual local PNG share image resolve |
| Faked live data | None: unconfigured terrain is explicitly an illustration; private demo is labeled |
| Publication | After submission capture; no public URL or new commit invented |
| VPS/containers/ARM64 | Not deployed or executed; installation source is delivered |

## Scope and consequential choices

This work builds on the accepted `server/`, `shared/`, `deploy/` and `tests/` contribution. It does not replace the ecology, learning algorithm, storage model or deployment configuration. New source is in `web/`; the production export is `dist/` with relative URLs. All frontend dependencies are installed outside the repository, from a delivered lockfile. No ignore file, protected dependency/build configuration, Git metadata or unrelated service was changed.

The world is a full-viewport Canvas 2D settlement with original yellow creature sprites and HTML observation controls. It has one consistent visual idea: an isometric clearing under quiet cream tools. No externally generated raster scene pretends to be a live world.

Historical note: the static-default claim above is no longer current. The shipped `dist/expanse-config.json` is configured with an owner deployment URL and `startMode: "live"`; `dist/demo/agency-manifest.json` resumes a schema-5 checkpoint at tick 12,600. The demo remains an explicit mode rather than a connection-failure fallback. The shared simulation remains authoritative, persistent and independent of browsers.

Coinbase Smart Wallet is reachable as a connector; actual smart-account authentication is not supported by the inherited EIP-191-only server. The UI discloses this limitation. No unverified smart-account success or transaction is shown.

## Requirements coverage

| Requested behavior | Evidence / boundary |
|---|---|
| “working shared-world web application” | Two Chromium pages receive identical world IDs, ticks and metrics from the real local WebSocket service; see `results/browser-checks.json` |
| “Until configured, show ‘World server not connected’” | Default screenshot and test assert this exact text and absence of live metrics; zero remote requests on initial load |
| “clearly labeled local demo/test mode” | Private demo in worker; real `DEMO_MODE=1` server labeled separately; no hidden switch on failure |
| “24 ... initial seed, not a population cap” | Existing default retained; long run reaches population 66 and records 2,625 births |
| “identity ... relationships ... learned state” | Existing persistent world retained; inspector displays actual API details; restart/learning tests pass |
| Autonomous food, rest, gather/build, growth, reproduction, scarcity, deaths | Existing simulation tests pass; stage/health/resource state drives renderer; lifecycle logs retained |
| Learning on/off, multiple reproducible seeds | Fresh 8-seed × 8,000-tick paired comparison in `results/learning-comparison.md`; algorithm in `server/docs/LEARNING.md` |
| Helpful/harmful wallet identity | EIP-6963 + personal-sign integration and inherited wallet-learning/auth tests; wallets explicitly described as accounts |
| Navigable 2D isometric scene and original animated creatures | Canvas pan/zoom/selection; actual touch pinch check; bodies/faces/limbs and action branches; screenshots of running prototype |
| Inspector, history, metrics and last update | Native controls, graphs and CSV checked; events deduplicate across reconnect; stale display freezes |
| Authenticated developer food/heal/fire/storm | Server enforces roles and limits; UI consequence confirmation; real developer route and anonymous rejection tested |
| Unique durable intervention IDs | Lost response, panel navigation, HTTP 5xx and exact-ID retry checked; server retention beyond 20,000 IDs and failed-save tests added |
| Persistence, backup/restore, migrations, downtime | Existing server tests rerun and passed; no instant unlimited lethal catch-up; installation/operations docs retained |
| Static export plus source/lockfile | `dist/index.html`, assets and worker; `web/` source and lockfile; `/preview/` subpath validated |
| Build, typecheck, meaningful interactions | Actual commands/results below; no verification inferred from source alone |
| Better Interface / DESIGN.md | All six domains reviewed below; actual source tokens and responsive behavior documented in root `DESIGN.md` |
| Actual evidence and remaining setup | Committed screenshots/results; required owner setup and unperformed checks are explicit |
| Publish URL / final commit | Assigned by IMD/submission after capture; no deployment endpoint/credentials supplied to this worker, no guessed URL |

## Actual commands and outcomes

All commands were run from the repository root. Browser runtimes/dependencies were kept in temporary directories.

| Command | Actual outcome |
|---|---|
| `node --test tests/*.test.js` | 23 passed, 0 failed; final server run about 12.6 seconds |
| `node web/scripts/task.mjs typecheck` | Exit 0, TypeScript `tsc --noEmit` |
| `node web/scripts/task.mjs test` | Exit 0, 7 client reducer/protocol tests |
| `node web/scripts/task.mjs build` | Exit 0, Vite production export to root `dist/` |
| `node web/scripts/check-browser.mjs` | Exit 0, 20 Chromium checks; WebKit attempted but missing host libraries |
| `node web/scripts/check-interface.mjs` | Exit 0, 9 checks, 7 axe states; actual color pairs and mobile wallet sheet |
| `node web/scripts/measure-service.mjs` | Exit 0: 500k ticks, six population cases, eight learning seeds, two 30-second client loads |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | With `IMD_PLAYWRIGHT` and `PLAYWRIGHT_BROWSERS_PATH` pointing to the temporary installation: exit 0, 16/16 passed |

The browser scripts own and close their preview/service/browser processes. They serve the actual export at `/preview/`. The provided browser tool was also used to inspect the final 390px demo and inspector: the snapshot showed real named meters/relationships, the screenshot showed the corrected panel, and its console reported zero errors/warnings. Early preview-process termination was an inspection harness issue, not a demo-engine failure; the owned-process scripts and final browser-tool pass both ran the worker successfully.

The build emits a warning from the unused transitive `ox` Tempo module about externalized `node:worker_threads`. There were no uncaught browser runtime errors in the tested flows. This is not a claim that every third-party wallet SDK path was exercised.

### Meaningful interaction states checked

- Unconfigured: no metrics, honest landscape label, usable demo/server actions, local-only assets, metadata and font loaded.
- Demo loading/success: worker starts, tick advances, local pause stops ticks, speed control is local, camera buttons/keys work, emulated pinch changes zoom.
- Residents: name search, empty result, clear filters, selection, three labeled needs, relationships/personality, actual memories and learned decisions.
- Tools: successful food/fire effects, destructive confirmation, stable mobile checkbox focus; actual developer role enforcement on the service.
- Auth: desktop EIP-6963 named provider, wallet-generated EIP-191 message through viem, nonce/expiry/origin server tests, visitor and developer capabilities; missing-provider failure inline.
- Phone sheet: four app-browser links, bundled marks, Coinbase Smart Wallet row, row sizes, bottom-sheet placement. Actual app handoff is unperformed.
- Network/error: unsafe remote HTTP URL rejected; lost response and 5xx preserve a request; retry after closing/reopening Tools uses the same ID and produces no duplicate effect; anonymous destructive POST gets 401.
- Reconnect/reset: two browser views agree; interrupted sockets reconnect; visible event sequence IDs remain unique; an explicit developer reset replaces world geometry and sequence.
- History: charts, event category filters, CSV download with resource columns; no fabricated points before history exists.
- Accessibility: keyboard Enter/Tab/Escape, native dialog focus containment and return, named controls, eight axe states, reduced-motion preference and settings. No screen-reader or native zoom session is claimed.

## Better Interface: six-domain coverage

| Domain | Status | What was inspected | Unperformed / not applicable |
|---|---|---|---|
| Accessibility | Checked | Native buttons/labels/meters/dialogs, skip link, keyboard pan/list selection, focus return/trap, reduced motion, errors, target sizes, axe scans | Physical screen reader; all forced-color/focus combinations over dynamic art; native browser 200% zoom |
| Layout | Checked | Actual 320/390/768/1440 widths, subpath export, first screen, stable sheets, scrollable lists, mobile checkbox layout, zero horizontal overflow | RTL/pseudo-localization; physical phone keyboard; English-only prototype |
| Writing | Checked | Clear connection/demo/stale labels, action names, retry instructions, explicit damage, template speech, smart-account limits, no consciousness/payment claims | No localization or marketing campaign copy in scope |
| Typography | Checked | Local font loaded, six source size tokens, three weights, numeric stability, wrapping, 16px inputs; probe used fewer sizes on entry screen | Non-Latin scripts and native text enlargement not tested |
| Colors | Checked | Eight actual solid pairs measured; opaque surfaces over canvas; text/icon redundant status cues | Every artwork pixel and third-party extension icon cannot be contrast-certified; no dark theme exists |
| UI | Checked | Hover/focus/disabled/pending/error/success/empty states, one icon system, restrained surfaces, motion off in reduced mode, dialog and panel geometry | Slow-motion replay of every sprite pose; actual external wallet prompts; WebKit unavailable |

### Measured rendered contrast

The extra browser script resolves actual computed text color and the nearest opaque background; these are measured values, not estimates. The pinned taste probe itself skips many boxes over a canvas even when a foreground panel is opaque, so its contrast pass alone was not used as proof.

| Pair | Ratio | Inspected roles |
|---|---:|---|
| `#263f31` on `#fafaf1` | 10.89:1 | Intro heading, world title, wallet control |
| `#5c6c58` on `#fafaf1` | 5.35:1 | Intro prose, fine print, world subtitle, status timestamp |
| `#fafaf1` on `#315d40` | 7.22:1 | Primary action |

All eight sampled pairs exceed 4.5:1. This does not certify every canvas asset, native input state or external wallet interface.

### Findings, fixes and rechecks

| Severity / domain | Final source location | Observed issue / exact correction | Recheck |
|---|---|---|---|
| High · accessibility | `web/src/Modal.tsx:20` | Repeated Tab could leave dialog controls in the tested browser/tool setup. Add explicit Tab/Shift+Tab wrapping while retaining native inertness and Escape/return behavior. | Repeated-Tab browser assertion and all dialog flows rechecked |
| High · layout/accessibility | `web/src/styles.css:1834` and `:1865` | At 390, footer status and speed controls covered inspector text. Hide those controls while the mobile sheet is open and hold the sheet between top 244px/bottom 96px. | Final mobile screenshot, tool snapshot, overflow/axe and integration assertions pass |
| High · UI/accessibility | `web/src/styles.css:1865` | Resizing a panel on `input:focus` moved the destructive checkbox between pointer-down and click. Removed that focus-dependent geometry; panel is stable and its body scrolls. | Actual checkbox `.check()` and emulated phone layout pass |
| Medium · UI/semantic truth | `web/src/renderer.ts:75` | Renderer initially used `move` rather than the real `go`/`do` phases and generic gathering labels. Map the engine’s actual phases and `GATHER_WOOD`/`GATHER_STONE` actions. | Working engine demo inspected; actual gather/carry/work code branches reviewed |
| Medium · color | `web/src/styles.css:1779` | Over-world text could cross dark foliage. Put headings/statuses on opaque paper reading surfaces. | Eight computed foreground/background pairs measured above |
| High · recovery | `web/src/Panels.tsx:749` | Uncertain requests could lose their ID when a panel closed; 5xx could incorrectly be treated as definite denial. Persist body/ID per service/world, display it, retain it on 5xx and retry exactly. | Lost-response + navigation + 5xx browser scenarios pass without a second effect |
| High · persistence | `server/src/world.js:426` | Pruning IDs after 20,000 records permitted a sufficiently old retry to apply twice. Retain all accepted IDs for a world. | Regression sends 20,002 interventions and retries the first: no new effect |
| High · persistence | `server/src/http.js:66`, `server/src/service.js:118` | A failed snapshot could still be acknowledged. Require successful save for intervention/backup, including duplicate retries. | Injected save failures return 500; later retry durably saves without applying again |
| Medium · reconnect | `web/src/service.ts:186`, `web/src/store.ts` | World changes need a full resync with sequence zero, not a delta over old tiles. Reset old selection/panel identity on a new world. | Actual server reset replaces both browser views; reducer tests cover rollback/reset |
| Medium · connector | `web/src/wallet.tsx` | Rabby app handoff needs its source-defined `open-dapp` command. Use `/mobile/?_cmd=open-dapp&dapp=` with the current encoded URL. | Phone link construction/marks/rows pass; physical app handoff remains untested |

No confirmed high/medium finding in the implemented client flow remains open. Smart-account verification, unavailable platform checks and production deployment are explicit limitations, not hidden working features.

## Local simulation and capacity measurements

Exact local machine report: **QEMU Virtual CPU version 2.5+**, **8 OS-reported logical CPUs**, **15.62 GiB OS-reported RAM**, Linux **6.12.107+deb13-amd64**, **x64**, Node **v24.21.0**. The target is Ubuntu ARM64 with 2 shared vCPUs/4 GB; that target was **not tested**. Shared scheduling/quota/effective host capacity were not inferred. The OS report and raw samples are in `results/hardware.json` and the other result files.

Long run: default seed 20260101, **500,000 ticks** (5.79 simulated days at the default 1-second tick) in **120.9 seconds**, **123.022 CPU seconds**. Tick elapsed p50 **0.154 ms**, p95 **0.568 ms**, p99 **0.861 ms**, max **58.432 ms**. Peak *sampled* RSS **290 MB**. Population peak **66**, final **53**; **2,625 births**, **2,596 deaths** (1,587 starvation, 784 old age, 225 exhaustion). Final snapshot **1,350,998 bytes**; serialization **63.9 ms**. This fast headless run is not a wall-clock soak and not proof of equilibrium across every seed. Starvation is a substantial tuning limitation.

| Initial creatures | Sim tick p50 / p95 / p99 (ms) | View+serialization p95 (ms) | Sampled RSS (MB) |
|---:|---:|---:|---:|
| 24 | 0.06 / 0.30 / 0.47 | 0.25 | 70 |
| 100 | 0.21 / 0.54 / 0.99 | 0.46 | 84 |
| 250 | 0.67 / 1.30 / 1.95 | 1.04 | 119 |
| 500 | 2.01 / 3.34 / 11.87 | 1.89 | 229 |
| 1,000 | 5.80 / 14.12 / 18.00 | 4.39 | 277 |
| 2,000 | 25.64 / 39.95 / 43.29 | 15.59 | 380 |

Each case warms 300 ticks and samples 600. Simulation/view only, no network in this table. No creature is removed for CPU; nearest-creature scans remain superlinear. The largest runtime snapshot is about 15 MB; runtime world snapshots are not submission artifacts.

| Local WebSocket load | Duration / tick | Messages / data | Final p95 / p99 | Server CPU samples | Peak sampled server RSS | Gaps / drops |
|---|---|---|---|---|---|---|
| 100 clients, 24 creatures | 30s / 250ms | 12,100 / 97.6 MB | 7.58 / 8.13 ms | 1.6–7.6% of one core | 99 MB | 0 / 0 |
| 200 clients, 250 creatures | 30s / 250ms | 24,119 / 1,780.7 MB | 72.52 / 88.18 ms | 28.4–33.2% of one core | 175 MB | 0 / 0 |

No overload flags or tick spread across clients in these runs. These are loopback load clients, with the server in a separate local process; they are not 200 rendered browsers, real users or internet/TLS measurements. Client processes share the machine. Their heavy bandwidth is a reason to measure the actual VPS/network, not claim production capacity.

### Learning comparison

Eight seeds, 8,000 ticks each, identical seeded initial worlds with learning enabled/disabled. Scripted helpful and harmful visitor behavior is the same in each pair. Fresh measured means: helpful approaches **2,635.5 on vs 137.6 off**; harmful approaches **3.75 vs 114.8**; avoidance of harmful wallet **585.0 vs 25.3**; hungry-adult fraction **0.150 vs 0.242**. Helpful/harmful wallet opinions averaged **+0.876 / −0.744** when learning was on. See full per-seed rows and standard deviations in `results/learning-comparison.md`.

This demonstrates learned visitor discrimination in the measured scenario. It does not establish consciousness or general intelligence. Survival and reproduction differences are less clear; births averaged 28.8 on vs 31.1 off. The algorithm, features/actions/rewards and limitations are in `server/docs/LEARNING.md`.

## Evidence and delivery boundaries

The historical `docs/screenshots/` directory and `web/public/share.png` are not included in this tree. The current share image is [`web/public/share-world.jpg`](../web/public/share-world.jpg), copied to the shipped [`dist/share-world.jpg`](../dist/share-world.jpg). Current living-world evidence and limitations are documented in [chains/VALIDATION.md](chains/VALIDATION.md). No video was generated or claimed.

Raw current evidence: `results/browser-checks.json`, `interface-checks.json`, `taste.json`, server/client/build/typecheck output and six measurement files. Earlier server-only evidence remains under `tests/results/` and is explicitly historical.

**Unperformed:** WebKit/Safari runtime (launch reports missing GTK/GStreamer and other system libraries), physical devices, native 200% browser zoom, screen-reader sessions, actual wallet-extension/app/passkey signing, smart-account signature verification, Docker/Compose image execution, ARM64, real VPS, public HTTPS/WSS/Caddy and long wall-clock uptime. Docker is not installed on this worker. No target capacity claim is made.

**Remaining operator setup:** install the provided server on the owner’s VPS; configure DNS/TLS, allowed client origins and actual developer wallet addresses; set the client’s HTTPS/WSS URLs; verify offsite backup/restore and monitor disk, population and tick latency. Deployment/publication is not established by building `dist/`.

Completion: the browser client, static export and supplied EIP-191 simulation protocol integration are implemented and locally checked. IMD publication/final commit occur after submission capture; VPS installation and the specifically listed unfinished platform/smart-account work remain. This is a prototype delivery, not a production security audit.
