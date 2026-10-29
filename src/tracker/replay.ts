import { decodeEventLog, encodeEventTopics, type Hex, type PublicClient } from "viem";
import {
  batchSettledEvent,
  checkpointedEvent,
  pausedEvent,
  reporterUpdatedEvent,
  trackedEvents,
  unpausedEvent,
} from "./abi.ts";
import type { BatchEvent, CheckpointEvent, ControlEvent, EventRef } from "./analyze.ts";
import { blockTimestamps, getLogsChunked, type RawLog } from "./rpc.ts";

const topic0 = (event: (typeof trackedEvents)[number]) => encodeEventTopics({ abi: [event] } as never)[0] as Hex;

export interface Replay {
  batches: BatchEvent[];
  controls: ControlEvent[];
  checkpoints: CheckpointEvent[];
  logCount: number;
}

/** Replay BatchSettled, Paused, Unpaused, ReporterUpdated and Checkpointed from the Core deploy block. */
export async function replay(
  client: PublicClient,
  opts: { core: Hex; mining: Hex; fromBlock: bigint; toBlock: bigint; onProgress?: (done: bigint, total: bigint) => void },
): Promise<Replay> {
  const logs = await getLogsChunked(
    client,
    {
      address: [opts.core, opts.mining],
      topics: [trackedEvents.map(topic0)],
      fromBlock: opts.fromBlock,
      toBlock: opts.toBlock,
    },
    opts.onProgress,
  );
  const times = await blockTimestamps(client, logs);
  const out: Replay = { batches: [], controls: [], checkpoints: [], logCount: logs.length };
  const core = opts.core.toLowerCase();
  const mining = opts.mining.toLowerCase();

  for (const log of logs) {
    const timestamp = times.get(log.blockHash.toLowerCase());
    if (timestamp === undefined) throw new Error(`No timestamp for block ${BigInt(log.blockNumber)}`);
    const ref: EventRef = {
      blockNumber: BigInt(log.blockNumber),
      logIndex: Number(BigInt(log.logIndex)),
      txHash: log.transactionHash,
      timestamp: Number(timestamp),
    };
    const from = log.address.toLowerCase();
    const decode = <E extends (typeof trackedEvents)[number]>(event: E) =>
      decodeEventLog({ abi: [event], data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }).args as never;
    const t0 = log.topics[0];
    if (from === core && t0 === topic0(batchSettledEvent)) {
      const a = decode(batchSettledEvent) as {
        digest: Hex; reporter: Hex; settledThroughRound: bigint; nonce: bigint; previousSettledThroughRound: bigint;
        activeRoundCount: number; cumulativeWork: bigint; cumulativeBlockUnits: bigint;
      };
      out.batches.push({ ...ref, ...a });
    } else if (from === core && t0 === topic0(pausedEvent)) {
      out.controls.push({ ...ref, kind: "PAUSED", account: (decode(pausedEvent) as { account: string }).account });
    } else if (from === core && t0 === topic0(unpausedEvent)) {
      out.controls.push({ ...ref, kind: "UNPAUSED", account: (decode(unpausedEvent) as { account: string }).account });
    } else if (from === core && t0 === topic0(reporterUpdatedEvent)) {
      const a = decode(reporterUpdatedEvent) as { previousReporter: string; newReporter: string };
      out.controls.push({ ...ref, kind: "REPORTER_UPDATED", ...a });
    } else if (from === mining && t0 === topic0(checkpointedEvent)) {
      const a = decode(checkpointedEvent) as { afterRound: bigint; throughRound: bigint; completedBlocks: bigint; amount: bigint };
      out.checkpoints.push({
        ...ref,
        afterRound: a.afterRound,
        throughRound: a.throughRound,
        completedBlocks: a.completedBlocks,
        amount: a.amount,
      });
    }
  }
  return out;
}

export type { RawLog };
