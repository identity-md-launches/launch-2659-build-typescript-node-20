// Approved Squeekchain Sepolia deployment record.
// Source: https://docs.squeekchain.com/developers/#environment-file and
// https://docs.squeekchain.com/assets/deployments/sepolia.json
// (release squeeks-sepolia-core3-mining6-001). Every value can be overridden
// with the environment variable of the same name from the docs' sepolia-env.sh.

export const RECORD_RELEASE = "squeeks-sepolia-core3-mining6-001";

const DEFAULTS = {
  EXPECTED_CHAIN_ID: "11155111",
  CORE_ADDRESS: "0x74665dAecA35A2303e767E76a2FF1FB6F93e119f",
  EXPECTED_CORE_IMPLEMENTATION: "0x0a71c86ab63a77675002a389fdf4d096a07b11e2",
  EXPECTED_CORE_RUNTIME_HASH: "0xe8a5a5aa913141ddd8951cf9fcc1375044b541773e5b0bf8ee04a5c7ac2d194d",
  EXPECTED_CORE_LAYOUT_DIGEST: "0x9a9c008e029460808209571703fbf2679785874e0e6d3232f16a864d12abcb20",
  EXPECTED_CORE_PROXY_ADMIN: "0x05a9af6c3f6780dd58168f2e145cdd0d64564a5e",
  MINING_ADDRESS: "0x3beE588fC20dE788Bac17d33b41Da7346cb27EC4",
  EXPECTED_MINING_IMPLEMENTATION: "0x08890b360c65fd878344bf6e23d1c36358433b4e",
  EXPECTED_MINING_RUNTIME_HASH: "0x6097cf8e8f96ea654878ab0a35410240ab1b05668c08ce1b3f99e04116e88bc1",
  EXPECTED_MINING_LAYOUT_DIGEST: "0xace564e9c052f30122779a32fdf3333ebce7cc708eae9c01cb7875b4f6ad37a6",
  EXPECTED_MINING_PROXY_ADMIN: "0x7369d930f8dfb7a6657578eda5906d3472e4ac9a",
  SQK_ADDRESS: "0x6872bfa5ccc3e9e440c6c16e5ffdabb8dba4cc76",
  NFT_ADDRESS: "0x0eAF3E0d40A0a8E5a6Ac030b2459E9FB0B7905c6",
  INDEX_FROM_BLOCK: "11902282",
  EXPECTED_TIMELOCK: "0x6B35AB6E96EF292E4fdD3f15a4E812f3CA291844",
  EXPECTED_STREAM_ID: "0xa0186b1a24b217f12f56c8574b492e286d00cd94bb5546cba45b048b19c60e44",
  EXPECTED_GENESIS_TIMESTAMP: "1791847800",
  EXPECTED_ROUND_DURATION: "600",
  EXPECTED_MAX_ROUNDS_PER_BATCH: "16",
  EXPECTED_BLOCK_UNITS_PER_BLOCK: "1000000000",
  EXPECTED_GUARDIAN: "0x0E1B21ED2fc5fc48E221D3E863f09589Cb490e73",
  EXPECTED_REPORTER: "0xB317AB7Cc24fD5d94EA120B3b189bc6527a7d0Aa",
  EXPECTED_MAX_WORK_PER_ROUND: "10000",
  EXPECTED_CORE_VERSION: "3",
  EXPECTED_MINING_VERSION: "6",
} as const;

export type RecordKey = keyof typeof DEFAULTS;

export const env = (key: RecordKey): string => process.env[key] || DEFAULTS[key];

// Public Sepolia endpoints that served eth_getLogs over the deployment range
// when this tracker was written. RPC_URL (comma-separated) replaces the list.
export const DEFAULT_RPC_URLS = [
  "https://eth-sepolia.api.onfinality.io/public",
  "https://0xrpc.io/sep",
  "https://ethereum-sepolia-rpc.publicnode.com",
];

export const rpcUrls = (): string[] =>
  (process.env.RPC_URL ? process.env.RPC_URL.split(",") : DEFAULT_RPC_URLS).map((u) => u.trim()).filter(Boolean);

export interface Thresholds {
  /** SETTLEMENT_LATENCY when a batch's oldest round waited longer than this. */
  latencySec: number;
  /** BATCH_GAP when two settlements are further apart than this. */
  batchGapSec: number;
  /** UNSETTLED_NOW when more closed rounds than this sit past the frontier. */
  unsettledRounds: number;
  /** MINING_CHECKPOINT_LAG when SqueekMining trails the frontier by more rounds than this. */
  checkpointLagRounds: number;
}

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
};

export const thresholds = (): Thresholds => ({
  latencySec: num("LATENCY_ALERT_SEC", 3600),
  batchGapSec: num("BATCH_GAP_ALERT_SEC", 3600),
  unsettledRounds: num("UNSETTLED_ALERT_ROUNDS", 6),
  checkpointLagRounds: num("CHECKPOINT_LAG_ALERT_ROUNDS", 36),
});
