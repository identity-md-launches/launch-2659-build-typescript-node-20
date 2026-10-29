import { decodeAbiParameters, getAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { graphAbi, identityAbi } from "./abi.ts";
import { env } from "./config.ts";

// The Squeekchain Quickstart "Verify the deployment" checks, run at one pinned
// block. Every check is recorded; the caller stops when any one fails.

export const IMPLEMENTATION_SLOT: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const ADMIN_SLOT: Hex = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

export interface Check {
  group: string;
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface VerifiedGraph {
  ok: boolean;
  checks: Check[];
  core: Address;
  mining: Address;
  token: Address;
  nft: Address;
  genesisTimestamp: bigint;
  roundDuration: bigint;
  reporter: Address;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const slotAddress = (word: Hex | undefined): Address => getAddress(`0x${(word ?? "0x").slice(-40).padStart(40, "0")}`);

export async function verifyGraph(client: PublicClient, blockNumber: bigint): Promise<VerifiedGraph> {
  const checks: Check[] = [];
  const check = (group: string, name: string, expected: unknown, actual: unknown, ok?: boolean) =>
    checks.push({
      group,
      name,
      expected: String(expected),
      actual: String(actual),
      ok: ok ?? same(String(expected), String(actual)),
    });
  const attempt = async <T>(group: string, name: string, expected: unknown, read: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await read();
    } catch (error) {
      check(group, name, expected, `read failed: ${(error as Error).message.split("\n")[0]}`, false);
      return undefined;
    }
  };

  // Execute CHAINID / MSTORE / RETURN as creation bytecode in eth_call.
  // No contract is deployed; chain identity uses the same pinned block and RPC allowlist.
  const { data } = await client.call({ data: "0x4660005260206000f3", blockNumber });
  const [chainId] = decodeAbiParameters([{ type: "uint256" }], data ?? "0x");
  check("network", "chain ID", env("EXPECTED_CHAIN_ID"), chainId);

  const proxy = async (name: "CORE" | "MINING", label: string, version: string) => {
    const address = getAddress(env(`${name}_ADDRESS`));
    const read = { address, abi: identityAbi, blockNumber } as const;
    const implWord = await client.getStorageAt({ address, slot: IMPLEMENTATION_SLOT, blockNumber });
    const implementation = slotAddress(implWord);
    check(label, "EIP-1967 implementation slot", env(`EXPECTED_${name}_IMPLEMENTATION`), implementation);
    const admin = slotAddress(await client.getStorageAt({ address, slot: ADMIN_SLOT, blockNumber }));
    check(label, "EIP-1967 admin slot", env(`EXPECTED_${name}_PROXY_ADMIN`), admin);
    const code = await client.getCode({ address: implementation, blockNumber });
    check(label, "implementation runtime code hash", env(`EXPECTED_${name}_RUNTIME_HASH`), code ? keccak256(code) : "no code");
    const reported = await attempt(label, "implementationCodeAddress()", implementation, () =>
      client.readContract({ ...read, functionName: "implementationCodeAddress" }),
    );
    if (reported !== undefined) check(label, "implementationCodeAddress()", implementation, reported);
    const layout = await attempt(label, "storage layout digest", env(`EXPECTED_${name}_LAYOUT_DIGEST`), () =>
      client.readContract({ ...read, functionName: "implementationStorageLayoutDigest" }),
    );
    if (layout !== undefined) check(label, "storage layout digest", env(`EXPECTED_${name}_LAYOUT_DIGEST`), layout);
    const codeVersion = await attempt(label, "implementation version", version, () =>
      client.readContract({ ...read, functionName: "implementationCodeVersion" }),
    );
    if (codeVersion !== undefined) check(label, "implementation version", version, codeVersion, codeVersion === BigInt(version));
    const adminOwner = await attempt(label, "ProxyAdmin owner is the timelock", env("EXPECTED_TIMELOCK"), () =>
      client.readContract({ address: admin, abi: identityAbi, functionName: "owner", blockNumber }),
    );
    if (adminOwner !== undefined) check(label, "ProxyAdmin owner is the timelock", env("EXPECTED_TIMELOCK"), adminOwner);
    return address;
  };

  const core = await proxy("CORE", "SqueekCore", env("EXPECTED_CORE_VERSION"));
  const mining = await proxy("MINING", "SqueekMining", env("EXPECTED_MINING_VERSION"));
  const token = getAddress(env("SQK_ADDRESS"));
  const nft = getAddress(env("NFT_ADDRESS"));

  const miningCore = await attempt("graph", "SqueekMining.core()", core, () =>
    client.readContract({ address: mining, abi: graphAbi, functionName: "core", blockNumber }),
  );
  if (miningCore !== undefined) check("graph", "SqueekMining.core()", core, miningCore);
  const tokenMining = await attempt("graph", "SqueekToken.mining()", mining, () =>
    client.readContract({ address: token, abi: graphAbi, functionName: "mining", blockNumber }),
  );
  if (tokenMining !== undefined) check("graph", "SqueekToken.mining()", mining, tokenMining);
  const policy = await attempt("graph", "SqueekMining.collectionPolicy(0).nft", nft, () =>
    client.readContract({ address: mining, abi: graphAbi, functionName: "collectionPolicy", args: [0], blockNumber }),
  );
  if (policy !== undefined) check("graph", "SqueekMining.collectionPolicy(0).nft", nft, policy.nft);

  const config = await client.readContract({ address: core, abi: graphAbi, functionName: "configuration", blockNumber });
  const launch = "launch config";
  check(launch, "streamId", env("EXPECTED_STREAM_ID"), config.streamId);
  check(launch, "genesisTimestamp", env("EXPECTED_GENESIS_TIMESTAMP"), config.genesisTimestamp);
  check(launch, "roundDuration", env("EXPECTED_ROUND_DURATION"), config.roundDuration);
  check(launch, "maxRoundsPerBatch", env("EXPECTED_MAX_ROUNDS_PER_BATCH"), config.maxRoundsPerBatch);
  check(launch, "maxWorkPerRound", env("EXPECTED_MAX_WORK_PER_ROUND"), config.maxWorkPerRound);
  check(launch, "blockUnitsPerBlock", env("EXPECTED_BLOCK_UNITS_PER_BLOCK"), config.blockUnitsPerBlock);
  check(launch, "guardian", env("EXPECTED_GUARDIAN"), config.guardian);
  check(launch, "reporter", env("EXPECTED_REPORTER"), config.reporter);

  return {
    ok: checks.every((c) => c.ok),
    checks,
    core,
    mining,
    token,
    nft,
    genesisTimestamp: config.genesisTimestamp,
    roundDuration: config.roundDuration,
    reporter: config.reporter,
  };
}
