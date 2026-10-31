# Visitor wallet release — 2026-10-31

Base Swarm delivery: `5e30bbde022c439852b5eb98f0317ccee233c643` (job `8564b523-aa6a-450c-b1df-843c829cb15d`).

Changes: a freshly verified signer replaces its own oldest session at the per-address cap. Evictions are committed only after profile persistence; failed signatures/storage cannot revoke existing sessions. Valid bodyless allowlisted preflights return 204 before authentication quotas/concurrency so the actual request can expose Retry-After. Unsupported origins/headers/methods remain rejected. Internal cancellation hashes are excluded from session responses. Docker permissions are normalized under root and imports run under node; the image check supports native Docker without Buildx. No simulation/brain/terrain/schema implementation changed.

Evidence in `/root/stratoks-wallet-validation` on the operator host and `/opt/stratoks/rollouts/wallet-r1` on the ARM server:

- Four new regression cases fail against the inherited code, then pass after the fixes.
- Full backend suite: 252/252; frontend suite: 34/34; typecheck and production build passed.
- Production HUD recovery suite: 16/16 Chromium scenarios. Six sign-in/reload cycles preserve the three-session cap and admit fresh signatures. Oldest credentials are invalid; latest three remain valid. Includes 320/390/768/1440px layouts, cancellation/account/network races, 429/503/offline/timeout recovery and logout.
- Separate real cross-origin Chromium test: allowed OPTIONS 204; actual GET 429 exposes a 60s cooldown; busy GET 503 exposes 1s; credential retained; recovery and logout succeed. No request interception or disabled browser security.
- Native linux/arm64 Docker image builds and starts as UID1000; code readable but not writable. Real disposable EOA signature verification, session, logout and anonymous world read passed.
- Copied nightly world at tick 317986, 454 residents: entire serialized world state unchanged after four logins, session replacement, logout and restart. Private visitor count persisted; sessions expired on restart. Identity digest `1328f462c97fe5883db0f4edfd0fa2bae7e1eea1efefa9f07166fd8dc126a30a`.

All browser providers are simulated EIP-6963/EIP-1193 with real disposable signatures and real local HTTP verification. Actual MetaMask/Rabby extensions, physical mobile devices and WebKit are not verified. No asset approvals, payments or owner signatures were used. Authentication is EOA-only; it adds no gameplay purchases or administrator rights.

Deployment retains a stopped-world archive and the previous volume/image/release, switches to a fresh copied volume, and configures the exact HTTPS AUTH_URI and exact preview origins. A private fixed-IP proxy network supplies the sole trusted forwarding peer; Caddy overwrites forwarded client addresses. Only Caddy publishes public ports. Reverting compose/Caddy to the saved copies restores the old volume; retain the newer volume for recovery. Never copy an advancing rehearsal world over live data.

## Live verification

Deployed source `37053ce6b603d380f999ce3a7cdd7a38bd297eb5` to `https://stratoks.2-29-11-211.sslip.io` on 2026-10-31. Cutover snapshot: world `world-20260101-0`, tick 344630, 315 residents; complete pre/post copy state matched before resuming ticks. The earlier rehearsal population (454) belongs to the overnight backup, not the later cutover snapshot. No resident was removed by this deployment.

Actual HTTPS browser tests passed at 1440px and 390px: anonymous viewing, injected disposable EOA connection, real server-verified signature, logout acknowledged and old credential rejected with 401, no page errors or horizontal overflow. World advanced from tick 344675 to 344693 during the checks. Real wallet extensions still require the owner's final check.

Live image: `stratoks-wallet:5e30bbd-r1`; source/static release `/opt/stratoks/releases/wallet-r1`; volume `stratoks_wallet_37053ce`. Previous volume `stratoks_agency_df59a04_r1` remains intact. Cutover archive is also retained off-host with matching SHA256 `c996a76daea993577b4f3b58ba18b0cf68583de9317548212c7b8cab287e1730`. Daily backup timer remains active. No IMD transaction was sent.
