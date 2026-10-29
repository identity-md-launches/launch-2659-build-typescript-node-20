import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, custom, encodeAbiParameters } from "viem";
import { verifyGraph } from "../src/tracker/verify.ts";

test("chain identity is read by an execution-only eth_call at the pinned block", async () => {
  const calls: { method: string; params?: unknown }[] = [];
  const stop = new Error("stop before deployment reads");
  const client = createPublicClient({
    transport: custom({ request: async (request) => {
      calls.push(request);
      if (request.method === "eth_call") return encodeAbiParameters([{ type: "uint256" }], [11155111n]);
      if (request.method === "eth_chainId") return "0xaa36a7";
      throw stop;
    } }, { retryCount: 0 }),
  });
  await assert.rejects(verifyGraph(client, 12017278n));
  assert.deepEqual(calls.map((c) => c.method), ["eth_call", "eth_getStorageAt"]);
  const [execution, at] = calls[0]!.params as [{ data: string; to?: string; from?: string }, string];
  assert.equal(execution.data, "0x4660005260206000f3");
  assert.equal(execution.to, undefined, "execution has no target: no deployed contract is needed");
  assert.equal(execution.from, undefined, "execution needs no account");
  assert.equal(at, `0x${(12017278).toString(16)}`);
});
