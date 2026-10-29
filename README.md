# Squeekchain settlement latency (Sepolia)

A read-only TypeScript tracker for how long SqueekCore takes to settle closed rounds on Sepolia. It also serves a small local dashboard.

It pins one finalized Sepolia block and runs the official [Squeekchain Quickstart](https://docs.squeekchain.com/developers/quickstart/) deployment checks at that block. If any check fails, it stops. If all pass, it replays every SqueekCore `BatchSettled`, `Paused`, `Unpaused` and `ReporterUpdated` event and every SqueekMining `Checkpointed` event from the Core deploy block (11902282). From those it computes per-batch latency, gaps and alerts and writes them to `out/`.

There's no wallet and no private keys. The only RPC methods it uses are `eth_call`, `eth_getStorageAt`, `eth_getCode`, `eth_getLogs` and `eth_getBlockByNumber`. Chain identity is checked by executing the EVM `CHAINID` opcode in a read-only `eth_call` at the pinned block; no contract is deployed.

## Quick start

Requires Node 20 or newer.

```sh
npm install
npm run verify        # Quickstart deployment checks at the current finalized block
npm run track         # verify, replay and write out/*.csv + out/summary.json
npm run build         # build the dashboard into dist/ and copy out/ into dist/data/
npm run serve         # http://127.0.0.1:4173/ serving dist/, with /data/* read live from out/
npm test              # unit tests for finality, RPC identity, latency and alerts
npm run typecheck     # tsc --noEmit over tracker, tests and dashboard
```

To reproduce the committed snapshot exactly, pin the same block: `npm run track -- --block 12017150` (or `ETHEREUM_BLOCK=12017150`).

Both `verify` and `track` resolve the finalized head even when a block is supplied. A block above that head is rejected before deployment checks or replay. Historical blocks at or below the finalized head remain available. If the RPC cannot resolve finality, the run stops.

### Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `RPC_URL` | onfinality, 0xrpc.io, publicnode (comma-separated fallback list) | Public Sepolia RPC(s). Must serve historical state and `eth_getLogs`. |
| `ETHEREUM_BLOCK` / `--block` | current `finalized` block | The one snapshot block every state read uses; must be at or below the finalized head |
| `OUT_DIR` / `--out` | `out` | Output directory |
| `LOG_CHUNK_BLOCKS` | `10000` | `eth_getLogs` range; it is halved automatically when an endpoint refuses |
| `LATENCY_ALERT_SEC` | `3600` | `SETTLEMENT_LATENCY` when a batch's oldest round waited longer than this |
| `BATCH_GAP_ALERT_SEC` | `3600` | `BATCH_GAP` when consecutive settlements are further apart than this |
| `UNSETTLED_ALERT_ROUNDS` | `6` | `UNSETTLED_NOW` when more closed rounds than this are past the frontier |
| `CHECKPOINT_LAG_ALERT_ROUNDS` | `36` | `MINING_CHECKPOINT_LAG` threshold, in rounds |
| `PORT`, `HOST` | `4173`, `127.0.0.1` | `npm run serve` address |

The expected deployment identities are built in from the docs' `sepolia-env.sh` and [`sepolia.json`](https://docs.squeekchain.com/assets/deployments/sepolia.json) (release `squeeks-sepolia-core3-mining6-001`). See `src/tracker/config.ts`. Any of them can be overridden with the environment variable of the same name, for example `EXPECTED_CORE_IMPLEMENTATION`.

## What it checks and computes

**Deployment checks** (`src/tracker/verify.ts`, 26 checks): chain ID, decoded as a uint256 from execution-only `eth_call` bytecode `0x4660005260206000f3` at the pinned block. For SqueekCore and SqueekMining: EIP-1967 implementation and admin slots, `implementationCodeAddress()`, keccak256 of the implementation runtime code, storage layout digest, implementation version (3 and 6), and ProxyAdmin `owner()` equal to the governance timelock. Graph links: `SqueekMining.core()`, `SqueekToken.mining()` and `SqueekMining.collectionPolicy(0).nft`. Launch config from `SqueekCore.configuration()`: streamId, genesis, roundDuration, maxRoundsPerBatch, maxWorkPerRound, blockUnitsPerBlock, guardian and reporter. Any mismatch stops the run before replay (exit 1). After the run, the tracker re-reads the pinned block and confirms its hash hasn't changed.

**Per batch** (`src/tracker/analyze.ts`). Round `r` covers `[genesis + (r-1)·600, genesis + r·600)` and closes at `genesis + r·600`, following the Quickstart's `currentRound` formula. A batch settles rounds `previousSettledThroughRound + 1 … settledThroughRound`.

- `oldestLatencySec` = batch block timestamp − close time of the first round in the batch
- `newestLatencySec` = batch block timestamp − close time of the last round in the batch
- `gapSincePrevSec` = seconds since the previous `BatchSettled`
- Unsettled closed rounds at the pinned block = `(currentRound − 1) − state().settledThroughRound`

**Alerts**

| Type | Raised when |
| --- | --- |
| `SETTLEMENT_LATENCY` | `oldestLatencySec` > threshold. Critical above 4× the threshold. |
| `BATCH_GAP` | `gapSincePrevSec` > threshold. Info if settlement was paused during the gap. |
| `UNSETTLED_NOW` | Unsettled closed rounds at the pinned block > threshold |
| `FRONTIER_DISCONTINUITY` | `previousSettledThroughRound` ≠ replayed frontier, a batch that doesn't advance, or a replayed frontier ≠ `state().settledThroughRound` |
| `NONCE_JUMP` | `nonce` ≠ previous batch nonce + 1. Info if the Paused/Unpaused calls in between account for it (each one advances the nonce), otherwise a warning. |
| `PAUSED` / `UNPAUSED` | Each Guardian pause or resume. Unpause reports how long settlement was paused. |
| `REPORTER_ROTATED` | Each `ReporterUpdated`. Info for the launch assignment from the zero address. |
| `MINING_CHECKPOINT_LAG` | A checkpoint transaction's first `afterRound` trails the frontier by more than the threshold (a lower bound on how far behind SqueekMining was), or `state().processedThroughRound` trails at the pinned block |

**Outputs** in `out/`:

- `batches.csv`: one row per `BatchSettled`
- `alerts.csv`: every alert
- `daily.csv`: one row per UTC day from the first event through the pinned block's date, including quiet days with no batches or alerts
- `summary.json`: pinned block and hash, all checks, current state, percentiles, alert counts, the 300 most recent alerts, the last 288 batches and the daily rollup. The dashboard reads this file.

## Dashboard and static export

The source is in `web/` (Vite + React + TypeScript). `vite.config.ts` sets `base: "./"`, so `dist/index.html` loads its assets and `data/summary.json` by relative URL. That makes it work from any static host or gateway subpath. `npm run build` runs `vite build`, then `src/cli/copy-data.ts`, which copies the latest `out/` into `dist/data/`.

- **Preview the committed export:** `npm run serve`, then open http://127.0.0.1:4173/. Or use any static server on `dist/`. `npm run preview` (Vite) also works.
- **Rebuild:** `npm run track` (new data), then `npm run build`. `dist/` is committed, including `dist/data/`, which is a byte-for-byte copy of the four `out/` files from the snapshot run. `out/` itself is excluded from this submission by the workspace's Git exclude rules. Run `npm run track` to regenerate it.
- **Develop:** `npm run dev` serves `web/` with hot reload. Data comes from `web/public/data/` if you copy it there; otherwise the page shows its "No tracker data yet" state.

On the dashboard you can:

- read the status summary
- jump to alerts with "Review N alerts"
- filter alerts by type and severity, and show more
- see a latency chart of the last 288 batches (log scale, with the threshold line)
- read the daily table
- download the four outputs
- expand the 26 deployment checks
- reload the data; if a refresh fails, the previous snapshot remains visible with a retry notice. The full-page error is reserved for a failed initial load.

## Snapshot in this repository

Run at finalized block **12017150** (`0xdbb95797…5850`, 2026-10-29 04:36:36 UTC):

- All 26 checks passed.
- Replayed 1,653 `BatchSettled`, 6 control events and 1,628 `Checkpointed`.
- Frontier is round 1973 against current round 2335: **361 closed rounds unsettled**. The oldest closed about 2d 12h before the block, and no settlement has happened since 2026-10-26.
- Median oldest-round latency is 36s, p90 84s, max 35h 55m (the 2026-10-21/22 pause and Reporter rotation).
- 21 alerts: `SETTLEMENT_LATENCY`=6, `BATCH_GAP`=4, `UNSETTLED_NOW`=1, `NONCE_JUMP`=1, `PAUSED`=2, `UNPAUSED`=2, `REPORTER_ROTATED`=2, `MINING_CHECKPOINT_LAG`=3.
- The `NONCE_JUMP` on 2026-10-22 (1111 to 1115) is one more than the pause and unpause explain. A Reporter rotation happened in between. The docs don't say whether rotation advances the nonce, so it stays a warning.

## Validation (worker-side, recorded honestly)

**Revision validation:** 13/13 unit tests, typecheck, production build, 66/66 Chromium interaction checks and 16/16 design-probe checks passed. Live verification passed 26/26 checks and a full replay at block 12017150 reproduced all three CSVs byte for byte. See [artifacts/validation.md](artifacts/validation.md) for reproductions, source locations, six-domain review and limitations. Finding verdicts are in [.imd-responses.json](.imd-responses.json).

The following table and review retain the original submission's results; the revision report above records the checks repeated for this change.

Commands run on this machine with Node 24.21.0:

| Check | Command | Result |
| --- | --- | --- |
| Deployment checks (live) | `npm run verify` | 26/26 PASS at block 12017150 |
| Full tracker (live) | `npm run track -- --block 12017150` | Completed in about 90s. Outputs above. Block hash unchanged on re-read. |
| Unit tests | `npm test` | 6/6 pass (round timing, latency/gap, latency/gap/discontinuity/unsettled alerts, nonce jumps, checkpoint lag, CSV/percentiles/slot decoding) |
| Typecheck | `npm run typecheck` | No errors (TypeScript 7.0.2) |
| Production build | `npm run build` | Vite 8.3.5. `dist/index.html`, 1 JS and 1 CSS asset, relative URLs. Data copied to `dist/data/`. |
| Interaction test | Playwright (Chromium headless shell 156) against `npm run serve`, at 390×844 and 1440×844 | 30/30 pass: status and main action on the first screen, "Review alerts" jumps to `#alerts`, paging (15, then 21), type filter, severity filter, empty state, checks disclosure (26 rows), `batches.csv` download (1,655 lines), no horizontal overflow, Reload, keyboard focus, no console errors, error state when `summary.json` is missing, and the static export loading its data from a gateway-style subpath (`/ipfs/site/`) |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16/16 pass at 320, 390 and 1440 wide. 1 control is under the 44px comfortable size (reported, not failing). Type sizes: 3 to 4 per width. The 390 screenshot was checked: headline, status, the four metrics and the "Review 21 alerts" action are all on the first screen. |

### Better Interface review

I used the pinned guide (`better-interface/REFERENCE.md`) while building, then reviewed the result against its six domains. I checked rendered behavior with Playwright scripts and screenshots, not an interactive browser tool.

- **Accessibility:**
  - Native `select`, radio `fieldset`/`legend`, `details`/`summary`, buttons and links.
  - Skip link to alerts.
  - Visible `:focus-visible` ring, including on the visually-hidden radios (via `input:focus-visible + span`).
  - Keyboard focus was verified.
  - The alert count is a `role="status"` live region; the load error uses `role="alert"`.
  - The chart has `role="img"` with a text caption that gives the range, threshold and how many batches crossed it.
  - The table has a scrollable `role="region"` that can take focus, with `scope` on its headers.
  - Hit targets are 44px for buttons, select and segments.
  - Not performed: screen-reader run, 200% zoom pass.
- **Layout:**
  - The status, metrics and main action come first; then alerts, chart, daily table, downloads and checks, in order of importance.
  - Content is grouped with spacing and hairlines, not nested cards.
  - No horizontal overflow at 320, 390 or 1440. The wide daily table scrolls inside its own region.
- **Writing:**
  - Buttons start with a verb ("Reload data", "Review 21 alerts", "Download batches.csv", "Show 6 more").
  - The empty state tells you what to do next ("Run npm run track, then npm run serve").
  - Alert codes appear as plain labels; the raw code is in `title` and in the CSVs.
  - Sentence case throughout.
- **Typography:**
  - One system sans plus mono for code only.
  - A 5-step scale (13/15/18/24/28px), with at most 4 sizes used at any one width.
  - `tabular-nums` on the body so figures don't shift; balanced headings.
- **Colors:**
  - Tokenised palette (`--bg`, `--ink`, `--accent`, three status pairs).
  - Status isn't shown by color alone: badges carry text and the headline states the condition.
  - The probe's contrast check passed for all measured text.
- **UI:**
  - Borders only, no shadows. One radius pair (10/6px).
  - Transitions limited to background and border color, and removed under `prefers-reduced-motion`.

**Findings fixed during review:**

1. `web/src/App.tsx` (alert badge) showed lowercase severities ("warning") while the filter used "Warning". Now both use sentence case (writing: one capitalization policy).
2. `web/src/styles.css` `.metric dd`: at 390 wide, "1,973 / 2,335" wrapped onto two lines at 24px. Metric values are now 18px on mobile and 24px from 48rem (layout: hold structure).
3. Alert type codes such as `SETTLEMENT_LATENCY` in all caps would be shouting in content. They're shown as plain labels instead (casing).

**Remaining limitations:**

- No screen-reader or native-device testing.
- Contrast was measured by the probe only, not per state (for example hover).
- The chart uses color plus height, and its caption carries the numbers.
- The browser checks used Chromium only.

### Repeat the optional browser regression check

The browser check serves `dist/` under `/preview/` and tests the committed snapshot, filters, paging, downloads, deployment disclosure, chart contrast, reload failure/retry and initial-load failure/retry at 320, 390, 768 and 1440 pixels. Install its optional tooling outside the repository:

```sh
npm install --prefix /tmp/squeek-browser-tests --cache /tmp/squeek-browser-cache playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/squeek-browser-browsers /tmp/squeek-browser-tests/node_modules/.bin/playwright install chromium
IMD_PLAYWRIGHT=/tmp/squeek-browser-tests/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/squeek-browser-browsers node tests/dashboard.browser.mjs
```

To check WebKit, install its browser and system libraries, then run the same command with `TEST_BROWSER=webkit`. WebKit could not launch on the revision worker because required system libraries were missing.

### Other limitations

- **GitHub publishing (requirement 8) was not done from this machine.** The `gh` CLI isn't installed (`gh: command not found`) and the repository has no Git remote. The full source is committed locally and ready to push with `git push <your-remote> main`.
- Public RPCs differ: publicnode refuses `eth_getLogs` ("pruned history unavailable"), and drpc and 1rpc cap ranges on their free tiers. The default list starts with endpoints that served the full range when this was written. Set `RPC_URL` if they stop doing so.
- Reorgs: the tracker reads at a finalized block and confirms its hash afterwards. It doesn't keep an incremental index across runs; each run replays from the deploy block, which takes about 90s.
- The checkpoint-lag measure uses the first `Checkpointed.afterRound` in a transaction. Unfunded stretches emit no event, so it's a lower bound.
