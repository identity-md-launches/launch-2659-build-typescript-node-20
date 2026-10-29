import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

// After `vite build`: copy the latest tracker run (out/) into dist/data/ so the
// static export ships a snapshot the dashboard can read without a server.
const files = ["summary.json", "batches.csv", "alerts.csv", "daily.csv"];
const from = process.env.OUT_DIR ?? "out";
await mkdir("dist/data", { recursive: true });
let copied = 0;
for (const f of files) {
  if (await stat(join(from, f)).catch(() => undefined)) {
    await copyFile(join(from, f), join("dist/data", f));
    copied += 1;
  }
}
console.log(copied ? `Copied ${copied} tracker outputs into dist/data/` : `No tracker outputs in ${from}/; run npm run track first.`);
