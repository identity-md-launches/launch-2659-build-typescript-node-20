import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex, PublicClient } from "viem";
import { pinBlock } from "../src/tracker/rpc.ts";

const hash: Hex = `0x${"ab".repeat(32)}`;
type Request = { blockTag?: string; blockNumber?: bigint };
const block = (number: bigint) => ({ number, hash, timestamp: 1_791_849_600n });
const stub = (read: (request: Request) => unknown) => ({ getBlock: async (request: Request) => read(request) }) as unknown as PublicClient;

test("an explicit block above the finalized head is rejected before reading it", async () => {
  const calls: Request[] = [];
  const client = stub((request) => {
    calls.push(request);
    return block(request.blockTag === "finalized" ? 100n : 101n);
  });
  await assert.rejects(pinBlock(client, "101"), /101.*finalized.*100/i);
  assert.deepEqual(calls, [{ blockTag: "finalized" }]);
});

test("historical finalized blocks and the finalized head remain available explicitly", async () => {
  for (const number of [90n, 100n]) {
    const calls: Request[] = [];
    const client = stub((request) => {
      calls.push(request);
      return block(request.blockTag === "finalized" ? 100n : request.blockNumber!);
    });
    assert.deepEqual(await pinBlock(client, String(number)), { ...block(number), tag: "explicit" });
    assert.deepEqual(calls, [{ blockTag: "finalized" }, { blockNumber: number }]);
  }
});

test("ETHEREUM_BLOCK obeys finality and an explicit argument still takes precedence", async () => {
  const previous = process.env.ETHEREUM_BLOCK;
  try {
    process.env.ETHEREUM_BLOCK = "101";
    const client = stub((request) => block(request.blockTag === "finalized" ? 100n : request.blockNumber!));
    await assert.rejects(pinBlock(client), /101.*finalized.*100/i);
    assert.equal((await pinBlock(client, "90")).number, 90n);
    delete process.env.ETHEREUM_BLOCK;
    assert.deepEqual(await pinBlock(client), { ...block(100n), tag: "finalized" });
  } finally {
    if (previous === undefined) delete process.env.ETHEREUM_BLOCK;
    else process.env.ETHEREUM_BLOCK = previous;
  }
});

test("explicit snapshots fail closed when finality is unavailable or lacks identity", async () => {
  await assert.rejects(pinBlock(stub(() => { throw new Error("finalized unavailable"); }), "90"), /finalized unavailable/);
  await assert.rejects(pinBlock(stub(() => ({ ...block(100n), number: null })), "90"), /finalized.*number or hash/i);
  await assert.rejects(pinBlock(stub(() => ({ ...block(100n), hash: null })), "90"), /finalized.*number or hash/i);
});

test("a historical block must still have a number and hash", async () => {
  const client = stub((request) => request.blockTag === "finalized" ? block(100n) : { ...block(90n), hash: null });
  await assert.rejects(pinBlock(client, "90"), /pinned.*number or hash/i);
});
