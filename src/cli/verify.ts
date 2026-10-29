import { argValue } from "./args.ts";
import { makeClient, pinBlock } from "../tracker/rpc.ts";
import { verifyGraph } from "../tracker/verify.ts";
import { RECORD_RELEASE } from "../tracker/config.ts";

// npm run verify [-- --block <n>]
// Runs the Quickstart deployment checks at one pinned block; exits 1 on any mismatch.
const client = makeClient();
const pinned = await pinBlock(client, argValue("--block"));
console.log(`Pinned ${pinned.tag} Sepolia block ${pinned.number} ${pinned.hash}`);
console.log(`Approved record: ${RECORD_RELEASE}\n`);
const graph = await verifyGraph(client, pinned.number);
for (const c of graph.checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.group.padEnd(14)} ${c.name}${c.ok ? "" : `\n      expected ${c.expected}\n      actual   ${c.actual}`}`);
}
const failed = graph.checks.filter((c) => !c.ok).length;
console.log(`\n${graph.checks.length - failed}/${graph.checks.length} checks passed at block ${pinned.number}.`);
if (failed) {
  console.error("Deployment does not match the approved record. Stopping.");
  process.exit(1);
}
