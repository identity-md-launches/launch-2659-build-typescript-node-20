import type { Thresholds } from "./config.ts";

// Pure settlement-latency analysis. No I/O: the tracker feeds decoded events
// and the pinned-block state in, and gets rows, alerts and a summary out.
// Seconds and round IDs fit comfortably in a JS number; nonces and cumulative
// totals stay bigint and are written out as decimal strings.

export interface EventRef {
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  timestamp: number;
}

export interface BatchEvent extends EventRef {
  digest: string;
  reporter: string;
  settledThroughRound: bigint;
  previousSettledThroughRound: bigint;
  nonce: bigint;
  activeRoundCount: number;
  cumulativeWork: bigint;
  cumulativeBlockUnits: bigint;
}

export type ControlEvent =
  | (EventRef & { kind: "PAUSED"; account: string })
  | (EventRef & { kind: "UNPAUSED"; account: string })
  | (EventRef & { kind: "REPORTER_UPDATED"; previousReporter: string; newReporter: string });

export interface CheckpointEvent extends EventRef {
  afterRound: bigint;
  throughRound: bigint;
  completedBlocks: bigint;
  amount: bigint;
}

export interface PinnedState {
  blockNumber: bigint;
  timestamp: number;
  settledThroughRound: bigint;
  authorizationNonce: bigint;
  paused: boolean;
  miningProcessedThroughRound: bigint;
}

export interface Timing {
  genesisTimestamp: number;
  roundDuration: number;
}

export type AlertType =
  | "SETTLEMENT_LATENCY"
  | "BATCH_GAP"
  | "UNSETTLED_NOW"
  | "FRONTIER_DISCONTINUITY"
  | "NONCE_JUMP"
  | "PAUSED"
  | "UNPAUSED"
  | "REPORTER_ROTATED"
  | "MINING_CHECKPOINT_LAG";

export const ALERT_TYPES: AlertType[] = [
  "SETTLEMENT_LATENCY",
  "BATCH_GAP",
  "UNSETTLED_NOW",
  "FRONTIER_DISCONTINUITY",
  "NONCE_JUMP",
  "PAUSED",
  "UNPAUSED",
  "REPORTER_ROTATED",
  "MINING_CHECKPOINT_LAG",
];

export type Severity = "info" | "warning" | "critical";

export interface Alert {
  type: AlertType;
  severity: Severity;
  blockNumber: string;
  timestamp: string;
  txHash: string;
  round: string;
  value: string;
  threshold: string;
  message: string;
}

export interface BatchRow {
  index: number;
  blockNumber: string;
  timestamp: string;
  txHash: string;
  logIndex: number;
  reporter: string;
  nonce: string;
  previousSettledThroughRound: string;
  settledThroughRound: string;
  roundsCovered: number;
  activeRoundCount: number;
  firstRoundCloseTime: string;
  lastRoundCloseTime: string;
  oldestLatencySec: number;
  newestLatencySec: number;
  gapSincePrevSec: number | "";
  frontierContinuous: boolean;
  cumulativeWork: string;
  cumulativeBlockUnits: string;
}

export interface DailyRow {
  date: string;
  batches: number;
  roundsSettled: number;
  activeRounds: number;
  medianOldestLatencySec: number;
  maxOldestLatencySec: number;
  medianNewestLatencySec: number;
  maxGapSec: number;
  alerts: number;
}

export interface Now {
  currentRound: number;
  closedRounds: number;
  settledThroughRound: number;
  unsettledClosedRounds: number;
  oldestUnsettledRoundCloseTime: string | null;
  oldestUnsettledWaitSec: number;
  paused: boolean;
  authorizationNonce: string;
  miningProcessedThroughRound: number;
  miningLagRounds: number;
}

export interface Analysis {
  batches: BatchRow[];
  alerts: Alert[];
  daily: DailyRow[];
  now: Now;
  stats: {
    batchCount: number;
    roundsSettled: number;
    activeRounds: number;
    zeroWorkBatches: number;
    oldestLatencySec: Percentiles;
    newestLatencySec: Percentiles;
    gapSincePrevSec: Percentiles;
    checkpoints: number;
    pauses: number;
    unpauses: number;
    reporterRotations: number;
  };
  alertCounts: Record<AlertType, number>;
}

export interface Percentiles {
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const iso = (unixSec: number) => new Date(unixSec * 1000).toISOString().replace(".000Z", "Z");

/** Round r covers [genesis + (r-1)·d, genesis + r·d) and closes at genesis + r·d. */
export const roundCloseTime = (round: bigint | number, t: Timing) => t.genesisTimestamp + Number(round) * t.roundDuration;

/** Current round by wall clock, as in the Quickstart's read-core.ts. */
export const currentRoundAt = (timestamp: number, t: Timing) =>
  timestamp < t.genesisTimestamp ? 0 : Math.floor((timestamp - t.genesisTimestamp) / t.roundDuration) + 1;

export const compareEvents = (a: EventRef, b: EventRef) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

export function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { min: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
  return { min: s[0]!, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: s[s.length - 1]! };
}

export const formatDuration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

export function analyze(input: {
  batches: BatchEvent[];
  controls: ControlEvent[];
  checkpoints: CheckpointEvent[];
  timing: Timing;
  pinned: PinnedState;
  thresholds: Thresholds;
}): Analysis {
  const { timing: t, thresholds: th, pinned } = input;
  const alerts: Alert[] = [];
  const alert = (a: Omit<Alert, "timestamp"> & { at: number }) => {
    const { at, ...rest } = a;
    alerts.push({ ...rest, timestamp: iso(at) });
  };

  type Item =
    | { k: "batch"; e: BatchEvent }
    | { k: "control"; e: ControlEvent }
    | { k: "checkpoint"; e: CheckpointEvent };
  const timeline: Item[] = [
    ...input.batches.map((e) => ({ k: "batch" as const, e })),
    ...input.controls.map((e) => ({ k: "control" as const, e })),
    ...input.checkpoints.map((e) => ({ k: "checkpoint" as const, e })),
  ].sort((a, b) => compareEvents(a.e, b.e));

  const rows: BatchRow[] = [];
  let frontier = 0n;
  let lastBatch: BatchEvent | undefined;
  let nonceVoids = 0n; // pauses + unpauses since the last batch; each advances the nonce
  let rotationsSinceBatch = 0;
  let pausedSince: number | undefined;
  let pausedDuringGap = false;
  const seenCheckpointTx = new Set<string>();

  for (const item of timeline) {
    if (item.k === "control") {
      const e = item.e;
      if (e.kind === "PAUSED") {
        nonceVoids += 1n;
        pausedSince = e.timestamp;
        pausedDuringGap = true;
        alert({
          type: "PAUSED",
          severity: lastBatch ? "warning" : "info",
          blockNumber: String(e.blockNumber),
          at: e.timestamp,
          txHash: e.txHash,
          round: String(frontier),
          value: e.account,
          threshold: "",
          message: `Settlement paused by ${e.account} with the frontier at round ${frontier}.`,
        });
      } else if (e.kind === "UNPAUSED") {
        nonceVoids += 1n;
        const pausedFor = pausedSince === undefined ? undefined : e.timestamp - pausedSince;
        pausedSince = undefined;
        alert({
          type: "UNPAUSED",
          severity: "info",
          blockNumber: String(e.blockNumber),
          at: e.timestamp,
          txHash: e.txHash,
          round: String(frontier),
          value: pausedFor === undefined ? "" : String(pausedFor),
          threshold: "",
          message:
            pausedFor === undefined
              ? `Settlement resumed by ${e.account}.`
              : `Settlement resumed by ${e.account} after ${formatDuration(pausedFor)} paused.`,
        });
      } else {
        const launch = e.previousReporter.toLowerCase() === ZERO_ADDRESS;
        if (!launch) rotationsSinceBatch += 1;
        alert({
          type: "REPORTER_ROTATED",
          severity: launch ? "info" : "warning",
          blockNumber: String(e.blockNumber),
          at: e.timestamp,
          txHash: e.txHash,
          round: String(frontier),
          value: e.newReporter,
          threshold: "",
          message: launch
            ? `Reporter set to ${e.newReporter} at launch.`
            : `Reporter rotated from ${e.previousReporter} to ${e.newReporter}.`,
        });
      }
      continue;
    }

    if (item.k === "checkpoint") {
      const e = item.e;
      // Only the first stretch of a checkpoint transaction says how far behind
      // SqueekMining was when the keeper acted; afterRound is a lower bound.
      if (seenCheckpointTx.has(e.txHash)) continue;
      seenCheckpointTx.add(e.txHash);
      const lag = Number(frontier - e.afterRound);
      if (lag > th.checkpointLagRounds) {
        alert({
          type: "MINING_CHECKPOINT_LAG",
          severity: "warning",
          blockNumber: String(e.blockNumber),
          at: e.timestamp,
          txHash: e.txHash,
          round: String(e.afterRound),
          value: String(lag),
          threshold: String(th.checkpointLagRounds),
          message: `Checkpoint started at round ${e.afterRound}, ${lag} settled rounds behind the frontier (${frontier}).`,
        });
      }
      continue;
    }

    const e = item.e;
    const first = e.previousSettledThroughRound + 1n;
    const last = e.settledThroughRound;
    const firstClose = roundCloseTime(first, t);
    const lastClose = roundCloseTime(last, t);
    const oldest = e.timestamp - firstClose;
    const newest = e.timestamp - lastClose;
    const gap = lastBatch ? e.timestamp - lastBatch.timestamp : undefined;
    const continuous = e.previousSettledThroughRound === frontier;
    const base = { blockNumber: String(e.blockNumber), at: e.timestamp, txHash: e.txHash, round: String(last) };

    if (!continuous) {
      alert({
        ...base,
        type: "FRONTIER_DISCONTINUITY",
        severity: "critical",
        value: String(e.previousSettledThroughRound),
        threshold: String(frontier),
        message: `Batch starts after round ${e.previousSettledThroughRound} but the replayed frontier is ${frontier}.`,
      });
    }
    if (last <= e.previousSettledThroughRound) {
      alert({
        ...base,
        type: "FRONTIER_DISCONTINUITY",
        severity: "critical",
        value: String(last),
        threshold: String(e.previousSettledThroughRound),
        message: `Batch does not advance the frontier (${e.previousSettledThroughRound} to ${last}).`,
      });
    }
    if (oldest > th.latencySec) {
      alert({
        ...base,
        round: String(first),
        type: "SETTLEMENT_LATENCY",
        severity: oldest > th.latencySec * 4 ? "critical" : "warning",
        value: String(oldest),
        threshold: String(th.latencySec),
        message: `Round ${first} settled ${formatDuration(oldest)} after it closed (rounds ${first} to ${last}).`,
      });
    }
    if (gap !== undefined && gap > th.batchGapSec) {
      alert({
        ...base,
        type: "BATCH_GAP",
        severity: pausedDuringGap ? "info" : "warning",
        value: String(gap),
        threshold: String(th.batchGapSec),
        message: `${formatDuration(gap)} without a settlement before this batch${pausedDuringGap ? " (settlement was paused in between)" : ""}.`,
      });
    }
    if (lastBatch) {
      const plain = lastBatch.nonce + 1n;
      if (e.nonce !== plain) {
        const explained = e.nonce === plain + nonceVoids;
        alert({
          ...base,
          type: "NONCE_JUMP",
          severity: explained ? "info" : "warning",
          value: String(e.nonce),
          threshold: String(plain),
          message: explained
            ? `Nonce moved from ${lastBatch.nonce} to ${e.nonce}; ${nonceVoids} pause/unpause call(s) in between account for it.`
            : `Nonce moved from ${lastBatch.nonce} to ${e.nonce}; ${nonceVoids} pause/unpause call(s) account for ${plain + nonceVoids}${rotationsSinceBatch ? ` and ${rotationsSinceBatch} Reporter rotation(s) also happened in between` : ""}.`,
        });
      }
    }

    rows.push({
      index: rows.length + 1,
      blockNumber: String(e.blockNumber),
      timestamp: iso(e.timestamp),
      txHash: e.txHash,
      logIndex: e.logIndex,
      reporter: e.reporter,
      nonce: String(e.nonce),
      previousSettledThroughRound: String(e.previousSettledThroughRound),
      settledThroughRound: String(last),
      roundsCovered: Number(last - e.previousSettledThroughRound),
      activeRoundCount: e.activeRoundCount,
      firstRoundCloseTime: iso(firstClose),
      lastRoundCloseTime: iso(lastClose),
      oldestLatencySec: oldest,
      newestLatencySec: newest,
      gapSincePrevSec: gap ?? "",
      frontierContinuous: continuous,
      cumulativeWork: String(e.cumulativeWork),
      cumulativeBlockUnits: String(e.cumulativeBlockUnits),
    });
    frontier = last;
    lastBatch = e;
    nonceVoids = 0n;
    rotationsSinceBatch = 0;
    pausedDuringGap = pausedSince !== undefined;
  }

  // State at the pinned block.
  const currentRound = currentRoundAt(pinned.timestamp, t);
  const closedRounds = Math.max(0, currentRound - 1);
  const settled = Number(pinned.settledThroughRound);
  const unsettled = Math.max(0, closedRounds - settled);
  const oldestUnsettledClose = unsettled > 0 ? roundCloseTime(settled + 1, t) : null;
  const oldestWait = oldestUnsettledClose === null ? 0 : pinned.timestamp - oldestUnsettledClose;
  const nowBase = { blockNumber: String(pinned.blockNumber), at: pinned.timestamp, txHash: "" };
  if (unsettled > th.unsettledRounds) {
    alert({
      ...nowBase,
      type: "UNSETTLED_NOW",
      severity: pinned.paused ? "critical" : "warning",
      round: String(settled + 1),
      value: String(unsettled),
      threshold: String(th.unsettledRounds),
      message: `${unsettled} closed rounds after round ${settled} are unsettled; the oldest closed ${formatDuration(oldestWait)} ago${pinned.paused ? " and settlement is paused" : ""}.`,
    });
  }
  if (Number(pinned.settledThroughRound) !== Number(frontier) && input.batches.length > 0) {
    alert({
      ...nowBase,
      type: "FRONTIER_DISCONTINUITY",
      severity: "critical",
      round: String(pinned.settledThroughRound),
      value: String(frontier),
      threshold: String(pinned.settledThroughRound),
      message: `Replayed frontier ${frontier} does not match state().settledThroughRound ${pinned.settledThroughRound}.`,
    });
  }
  const miningLag = Math.max(0, settled - Number(pinned.miningProcessedThroughRound));
  if (miningLag > th.checkpointLagRounds) {
    alert({
      ...nowBase,
      type: "MINING_CHECKPOINT_LAG",
      severity: "warning",
      round: String(pinned.miningProcessedThroughRound),
      value: String(miningLag),
      threshold: String(th.checkpointLagRounds),
      message: `SqueekMining has processed through round ${pinned.miningProcessedThroughRound}, ${miningLag} settled rounds behind the frontier.`,
    });
  }

  // Daily rollup by UTC date of the settlement block.
  const byDay = new Map<string, BatchRow[]>();
  for (const r of rows) {
    const day = r.timestamp.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const alertsByDay = new Map<string, number>();
  for (const a of alerts) alertsByDay.set(a.timestamp.slice(0, 10), (alertsByDay.get(a.timestamp.slice(0, 10)) ?? 0) + 1);
  // Every UTC day from the first event to the pinned block, so a stall shows as empty days.
  const known = [...new Set([...byDay.keys(), ...alertsByDay.keys()])].sort();
  const days: string[] = [];
  if (known.length) {
    const lastDay = Date.parse(`${iso(pinned.timestamp).slice(0, 10)}T00:00:00Z`);
    for (let d = Date.parse(`${known[0]}T00:00:00Z`); d <= lastDay; d += 86_400_000) {
      days.push(new Date(d).toISOString().slice(0, 10));
    }
  }
  const daily: DailyRow[] = days.map((date) => {
    const rs = byDay.get(date) ?? [];
    const gaps = rs.map((r) => r.gapSincePrevSec).filter((g): g is number => g !== "");
    return {
      date,
      batches: rs.length,
      roundsSettled: rs.reduce((n, r) => n + r.roundsCovered, 0),
      activeRounds: rs.reduce((n, r) => n + r.activeRoundCount, 0),
      medianOldestLatencySec: percentiles(rs.map((r) => r.oldestLatencySec)).p50,
      maxOldestLatencySec: percentiles(rs.map((r) => r.oldestLatencySec)).max,
      medianNewestLatencySec: percentiles(rs.map((r) => r.newestLatencySec)).p50,
      maxGapSec: gaps.length ? Math.max(...gaps) : 0,
      alerts: alertsByDay.get(date) ?? 0,
    };
  });

  const alertCounts = Object.fromEntries(ALERT_TYPES.map((k) => [k, 0])) as Record<AlertType, number>;
  for (const a of alerts) alertCounts[a.type] += 1;
  alerts.sort((a, b) => (a.timestamp === b.timestamp ? 0 : a.timestamp < b.timestamp ? -1 : 1));

  return {
    batches: rows,
    alerts,
    daily,
    now: {
      currentRound,
      closedRounds,
      settledThroughRound: settled,
      unsettledClosedRounds: unsettled,
      oldestUnsettledRoundCloseTime: oldestUnsettledClose === null ? null : iso(oldestUnsettledClose),
      oldestUnsettledWaitSec: oldestWait,
      paused: pinned.paused,
      authorizationNonce: String(pinned.authorizationNonce),
      miningProcessedThroughRound: Number(pinned.miningProcessedThroughRound),
      miningLagRounds: miningLag,
    },
    stats: {
      batchCount: rows.length,
      roundsSettled: rows.reduce((n, r) => n + r.roundsCovered, 0),
      activeRounds: rows.reduce((n, r) => n + r.activeRoundCount, 0),
      zeroWorkBatches: rows.filter((r) => r.activeRoundCount === 0).length,
      oldestLatencySec: percentiles(rows.map((r) => r.oldestLatencySec)),
      newestLatencySec: percentiles(rows.map((r) => r.newestLatencySec)),
      gapSincePrevSec: percentiles(rows.map((r) => r.gapSincePrevSec).filter((g): g is number => g !== "")),
      checkpoints: seenCheckpointTx.size,
      pauses: input.controls.filter((c) => c.kind === "PAUSED").length,
      unpauses: input.controls.filter((c) => c.kind === "UNPAUSED").length,
      reporterRotations: input.controls.filter((c) => c.kind === "REPORTER_UPDATED").length,
    },
    alertCounts,
  };
}
