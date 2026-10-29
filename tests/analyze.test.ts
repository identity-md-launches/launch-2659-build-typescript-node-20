import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, currentRoundAt, percentiles, roundCloseTime, type BatchEvent, type ControlEvent } from "../src/tracker/analyze.ts";
import { toCsv } from "../src/tracker/csv.ts";
import { slotAddress } from "../src/tracker/verify.ts";

const timing = { genesisTimestamp: 1_000_000, roundDuration: 600 };
const thresholds = { latencySec: 3600, batchGapSec: 3600, unsettledRounds: 6, checkpointLagRounds: 36 };
let log = 0;
const batch = (prev: number, through: number, at: number, nonce: number, active = 1): BatchEvent => ({
  blockNumber: BigInt(100 + log),
  logIndex: log++,
  txHash: `0x${log.toString(16).padStart(64, "0")}`,
  timestamp: at,
  digest: "0x",
  reporter: "0xR",
  settledThroughRound: BigInt(through),
  previousSettledThroughRound: BigInt(prev),
  nonce: BigInt(nonce),
  activeRoundCount: active,
  cumulativeWork: 0n,
  cumulativeBlockUnits: 0n,
});
const control = (kind: "PAUSED" | "UNPAUSED", at: number): ControlEvent => ({
  blockNumber: BigInt(100 + log),
  logIndex: log++,
  txHash: "0xc",
  timestamp: at,
  kind,
  account: "0xG",
});
const pinned = (at: number, settled: number, mining = settled) => ({
  blockNumber: 999n,
  timestamp: at,
  settledThroughRound: BigInt(settled),
  authorizationNonce: 0n,
  paused: false,
  miningProcessedThroughRound: BigInt(mining),
});
const close = (r: number) => roundCloseTime(r, timing);

test("round close times follow the Quickstart's current-round formula", () => {
  assert.equal(close(1), 1_000_600);
  assert.equal(currentRoundAt(1_000_000, timing), 1);
  assert.equal(currentRoundAt(1_000_599, timing), 1);
  assert.equal(currentRoundAt(1_000_600, timing), 2);
  assert.equal(currentRoundAt(999_999, timing), 0);
});

test("oldest/newest latency and gap per batch", () => {
  const b1 = batch(0, 3, close(3) + 40, 1);
  const b2 = batch(3, 4, close(4) + 30, 2, 0);
  const r = analyze({ batches: [b1, b2], controls: [], checkpoints: [], timing, pinned: pinned(close(4) + 100, 4), thresholds });
  assert.equal(r.batches[0]!.oldestLatencySec, close(3) + 40 - close(1));
  assert.equal(r.batches[0]!.newestLatencySec, 40);
  assert.equal(r.batches[0]!.gapSincePrevSec, "");
  assert.equal(r.batches[1]!.oldestLatencySec, 30);
  assert.equal(r.batches[1]!.gapSincePrevSec, 590);
  assert.equal(r.stats.zeroWorkBatches, 1);
  assert.equal(r.alerts.length, 0);
});

test("latency, gap, discontinuity and unsettled alerts", () => {
  const b1 = batch(0, 1, close(1) + 10, 1);
  const b2 = batch(1, 10, close(10) + 10, 2); // round 2 waited 8 rounds + 10s, gap 9 rounds
  const b3 = batch(12, 13, close(13) + 10, 3); // skips rounds 11-12
  const r = analyze({ batches: [b1, b2, b3], controls: [], checkpoints: [], timing, pinned: pinned(close(25) + 1, 13), thresholds });
  const types = r.alerts.map((a) => a.type);
  assert.ok(types.includes("SETTLEMENT_LATENCY"));
  assert.ok(types.includes("BATCH_GAP"));
  assert.ok(types.includes("FRONTIER_DISCONTINUITY"));
  assert.equal(r.now.currentRound, 26);
  assert.equal(r.now.unsettledClosedRounds, 12);
  assert.equal(r.alertCounts.UNSETTLED_NOW, 1);
  assert.equal(r.batches[2]!.frontierContinuous, false);
});

test("nonce jumps explained by pause/unpause are info, others warnings", () => {
  const b1 = batch(0, 1, close(1) + 10, 5);
  const p = control("PAUSED", close(1) + 20);
  const u = control("UNPAUSED", close(1) + 30);
  const b2 = batch(1, 2, close(2) + 10, 8);
  const b3 = batch(2, 3, close(3) + 10, 12);
  const r = analyze({ batches: [b1, b2, b3], controls: [p, u], checkpoints: [], timing, pinned: pinned(close(3) + 20, 3), thresholds });
  const jumps = r.alerts.filter((a) => a.type === "NONCE_JUMP");
  assert.deepEqual(jumps.map((a) => a.severity), ["info", "warning"]);
  assert.equal(r.alertCounts.PAUSED, 1);
  assert.equal(r.alertCounts.UNPAUSED, 1);
});

test("mining checkpoint lag at a checkpoint and at the pinned block", () => {
  const b1 = batch(0, 50, close(50) + 10, 1);
  const cp = {
    blockNumber: BigInt(100 + log),
    logIndex: log++,
    txHash: "0xcp",
    timestamp: close(50) + 20,
    afterRound: 2n,
    throughRound: 50n,
    completedBlocks: 0n,
    amount: 0n,
  };
  const r = analyze({ batches: [b1], controls: [], checkpoints: [cp], timing, pinned: pinned(close(50) + 30, 50, 10), thresholds });
  assert.equal(r.alertCounts.MINING_CHECKPOINT_LAG, 2);
  assert.equal(r.now.miningLagRounds, 40);
});

test("percentiles, CSV quoting and slot decoding", () => {
  assert.deepEqual(percentiles([5, 1, 3]), { min: 1, p50: 3, p90: 5, p99: 5, max: 5 });
  assert.equal(toCsv([{ a: 'x,"y"', b: 1 }], ["a", "b"]), 'a,b\n"x,""y""",1\n');
  assert.equal(
    slotAddress("0x0000000000000000000000000a71c86ab63a77675002a389fdf4d096a07b11e2").toLowerCase(),
    "0x0a71c86ab63a77675002a389fdf4d096a07b11e2",
  );
});
