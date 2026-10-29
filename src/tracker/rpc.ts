import { createPublicClient, fallback, http, type Address, type Hex, type PublicClient } from "viem";
import { rpcUrls } from "./config.ts";

// Read-only by construction: the tracker only ever calls eth_call,
// eth_getStorageAt, eth_getCode, eth_getLogs and eth_getBlockByNumber.
export function makeClient(urls = rpcUrls()): PublicClient {
  return createPublicClient({
    transport: fallback(urls.map((url) => http(url, { timeout: 90_000, retryCount: 2, retryDelay: 750 }))),
  }) as PublicClient;
}

export interface PinnedBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
  tag: "finalized" | "explicit";
}

/** One finalized block for every read, including historical ETHEREUM_BLOCK / --block snapshots. */
export async function pinBlock(client: PublicClient, explicit?: string): Promise<PinnedBlock> {
  const requested = explicit ?? process.env.ETHEREUM_BLOCK;
  const finalized = await client.getBlock({ blockTag: "finalized" });
  if (finalized.number === null || finalized.hash === null) throw new Error("Finalized block has no number or hash");
  if (requested && BigInt(requested) > finalized.number) {
    throw new Error(`Requested block ${requested} is above finalized head ${finalized.number}. Choose a finalized block.`);
  }
  const block = requested
    ? await client.getBlock({ blockNumber: BigInt(requested) })
    : finalized;
  if (block.number === null || block.hash === null) throw new Error("Pinned block has no number or hash");
  return { number: block.number, hash: block.hash, timestamp: block.timestamp, tag: requested ? "explicit" : "finalized" };
}

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  blockTimestamp?: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  removed?: boolean;
}

/**
 * eth_getLogs over [from, to] in bounded ranges, oldest first. A range an
 * endpoint refuses is halved until it fits (down to 50 blocks).
 */
export async function getLogsChunked(
  client: PublicClient,
  params: { address: Address[]; topics: (Hex | Hex[] | null)[]; fromBlock: bigint; toBlock: bigint },
  onProgress?: (done: bigint, total: bigint) => void,
): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let chunk = BigInt(process.env.LOG_CHUNK_BLOCKS ?? "10000");
  let from = params.fromBlock;
  const total = params.toBlock - params.fromBlock + 1n;
  while (from <= params.toBlock) {
    const to = from + chunk - 1n > params.toBlock ? params.toBlock : from + chunk - 1n;
    try {
      const logs = (await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: params.address,
            topics: params.topics,
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${to.toString(16)}`,
          },
        ],
      } as never)) as RawLog[];
      out.push(...logs.filter((l) => !l.removed));
      from = to + 1n;
      onProgress?.(from - params.fromBlock, total);
    } catch (error) {
      if (chunk <= 50n) throw error;
      chunk = chunk / 2n;
    }
  }
  return out;
}

/** Fill in block timestamps for logs from endpoints that do not return blockTimestamp. */
export async function blockTimestamps(client: PublicClient, logs: RawLog[]): Promise<Map<string, bigint>> {
  const times = new Map<string, bigint>();
  const missing = new Set<string>();
  for (const log of logs) {
    if (log.blockTimestamp) times.set(log.blockHash.toLowerCase(), BigInt(log.blockTimestamp));
    else missing.add(log.blockNumber);
  }
  const queue = [...missing];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const block = await client.getBlock({ blockNumber: BigInt(next) });
      if (block.hash) times.set(block.hash.toLowerCase(), block.timestamp);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return times;
}
