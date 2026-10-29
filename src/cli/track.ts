import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argValue } from "./args.ts";
import { coreStateAbi, miningStateAbi } from "../tracker/abi.ts";
import { analyze, type BatchRow, type Alert, type DailyRow } from "../tracker/analyze.ts";
import { env, RECORD_RELEASE, rpcUrls, thresholds } from "../tracker/config.ts";
import { toCsv } from "../tracker/csv.ts";
import { replay } from "../tracker/replay.ts";
import { makeClient, pinBlock } from "../tracker/rpc.ts";
import { verifyGraph } from "../tracker/verify.ts";

// npm run track [-- --block <n>] [-- --out <dir>]
// Verify the deployment at one pinned block, replay settlements and write out/.
const outDir = argValue("--out") ?? process.env.OUT_DIR ?? "out";
const th = thresholds();
const client = makeClient();
const pinned = await pinBlock(client, argValue("--block"));
const blockNumber = pinned.number;
console.log(`Pinned ${pinned.tag} Sepolia block ${blockNumber} ${pinned.hash}`);

const graph = await verifyGraph(client, blockNumber);
const failed = graph.checks.filter((c) => !c.ok);
console.log(`Deployment checks: ${graph.checks.length - failed.length}/${graph.checks.length} passed`);
if (failed.length) {
  for (const c of failed) console.error(`FAIL ${c.group} ${c.name}: expected ${c.expected}, got ${c.actual}`);
  console.error("Deployment does not match the approved record. Stopping before any replay.");
  process.exit(1);
}

const [coreState, miningState] = await Promise.all([
  client.readContract({ address: graph.core, abi: coreStateAbi, functionName: "state", blockNumber }),
  client.readContract({ address: graph.mining, abi: miningStateAbi, functionName: "state", blockNumber }),
]);

const fromBlock = BigInt(env("INDEX_FROM_BLOCK"));
let lastPct = -1;
const events = await replay(client, {
  core: graph.core,
  mining: graph.mining,
  fromBlock,
  toBlock: blockNumber,
  onProgress: (done, total) => {
    const pct = Number((done * 100n) / total);
    if (pct >= lastPct + 10 || pct === 100) {
      lastPct = pct;
      console.log(`  logs ${pct}% (${done}/${total} blocks)`);
    }
  },
});
console.log(
  `Replayed ${events.batches.length} BatchSettled, ${events.controls.length} Paused/Unpaused/ReporterUpdated, ${events.checkpoints.length} Checkpointed`,
);

const result = analyze({
  ...events,
  timing: { genesisTimestamp: Number(graph.genesisTimestamp), roundDuration: Number(graph.roundDuration) },
  pinned: {
    blockNumber,
    timestamp: Number(pinned.timestamp),
    settledThroughRound: coreState.settledThroughRound,
    authorizationNonce: coreState.authorizationNonce,
    paused: coreState.paused,
    miningProcessedThroughRound: miningState.processedThroughRound,
  },
  thresholds: th,
});

// Detect a reorganisation during the reads, as the Quickstart recommends.
const again = await client.getBlock({ blockNumber });
if (again.hash !== pinned.hash) {
  console.error(`Block ${blockNumber} hash changed during the run (${pinned.hash} -> ${again.hash}). Rerun.`);
  process.exit(1);
}

const batchColumns: (keyof BatchRow & string)[] = [
  "index", "blockNumber", "timestamp", "txHash", "logIndex", "reporter", "nonce", "previousSettledThroughRound",
  "settledThroughRound", "roundsCovered", "activeRoundCount", "firstRoundCloseTime", "lastRoundCloseTime",
  "oldestLatencySec", "newestLatencySec", "gapSincePrevSec", "frontierContinuous", "cumulativeWork", "cumulativeBlockUnits",
];
const alertColumns: (keyof Alert & string)[] = [
  "timestamp", "type", "severity", "blockNumber", "txHash", "round", "value", "threshold", "message",
];
const dailyColumns: (keyof DailyRow & string)[] = [
  "date", "batches", "roundsSettled", "activeRounds", "medianOldestLatencySec", "maxOldestLatencySec",
  "medianNewestLatencySec", "maxGapSec", "alerts",
];

const summary = {
  generatedAt: new Date().toISOString(),
  release: RECORD_RELEASE,
  chainId: Number(env("EXPECTED_CHAIN_ID")),
  rpcHosts: rpcUrls().map((u) => new URL(u).host),
  pinnedBlock: {
    number: String(blockNumber),
    hash: pinned.hash,
    timestamp: new Date(Number(pinned.timestamp) * 1000).toISOString(),
    tag: pinned.tag,
    hashRecheck: "unchanged",
  },
  replay: { fromBlock: String(fromBlock), toBlock: String(blockNumber), logs: events.logCount },
  contracts: { core: graph.core, mining: graph.mining, token: graph.token, nft: graph.nft },
  verification: { ok: graph.ok, passed: graph.checks.length, checks: graph.checks },
  timing: { genesisTimestamp: Number(graph.genesisTimestamp), roundDurationSec: Number(graph.roundDuration) },
  reporter: graph.reporter,
  thresholds: th,
  now: result.now,
  stats: result.stats,
  alertCounts: result.alertCounts,
  recentAlerts: result.alerts.slice(-300).reverse(),
  recentBatches: result.batches.slice(-288).map((b) => ({
    index: b.index,
    blockNumber: b.blockNumber,
    timestamp: b.timestamp,
    txHash: b.txHash,
    settledThroughRound: b.settledThroughRound,
    roundsCovered: b.roundsCovered,
    activeRoundCount: b.activeRoundCount,
    oldestLatencySec: b.oldestLatencySec,
    newestLatencySec: b.newestLatencySec,
    gapSincePrevSec: b.gapSincePrevSec,
  })),
  daily: result.daily,
  files: ["batches.csv", "alerts.csv", "daily.csv", "summary.json"],
};

await mkdir(outDir, { recursive: true });
await Promise.all([
  writeFile(join(outDir, "batches.csv"), toCsv(result.batches, batchColumns)),
  writeFile(join(outDir, "alerts.csv"), toCsv(result.alerts, alertColumns)),
  writeFile(join(outDir, "daily.csv"), toCsv(result.daily, dailyColumns)),
  writeFile(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
]);

const { now, stats } = result;
console.log(`\nFrontier ${now.settledThroughRound}, current round ${now.currentRound}, unsettled closed rounds ${now.unsettledClosedRounds}`);
console.log(`Oldest-round latency p50 ${stats.oldestLatencySec.p50}s, p90 ${stats.oldestLatencySec.p90}s, max ${stats.oldestLatencySec.max}s`);
console.log(`Alerts: ${Object.entries(result.alertCounts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`Wrote ${outDir}/batches.csv, alerts.csv, daily.csv, summary.json`);
