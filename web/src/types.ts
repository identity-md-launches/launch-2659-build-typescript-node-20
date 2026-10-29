// Shape of out/summary.json as written by src/cli/track.ts.

export type Severity = "info" | "warning" | "critical";

export interface Alert {
  type: string;
  severity: Severity;
  blockNumber: string;
  timestamp: string;
  txHash: string;
  round: string;
  value: string;
  threshold: string;
  message: string;
}

export interface Percentiles {
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export interface Summary {
  generatedAt: string;
  release: string;
  chainId: number;
  rpcHosts: string[];
  pinnedBlock: { number: string; hash: string; timestamp: string; tag: string; hashRecheck: string };
  replay: { fromBlock: string; toBlock: string; logs: number };
  contracts: { core: string; mining: string; token: string; nft: string };
  verification: { ok: boolean; passed: number; checks: { group: string; name: string; expected: string; actual: string; ok: boolean }[] };
  timing: { genesisTimestamp: number; roundDurationSec: number };
  reporter: string;
  thresholds: { latencySec: number; batchGapSec: number; unsettledRounds: number; checkpointLagRounds: number };
  now: {
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
  };
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
  alertCounts: Record<string, number>;
  recentAlerts: Alert[];
  recentBatches: {
    index: number;
    blockNumber: string;
    timestamp: string;
    txHash: string;
    settledThroughRound: string;
    roundsCovered: number;
    activeRoundCount: number;
    oldestLatencySec: number;
    newestLatencySec: number;
    gapSincePrevSec: number | "";
  }[];
  daily: {
    date: string;
    batches: number;
    roundsSettled: number;
    activeRounds: number;
    medianOldestLatencySec: number;
    maxOldestLatencySec: number;
    medianNewestLatencySec: number;
    maxGapSec: number;
    alerts: number;
  }[];
}
