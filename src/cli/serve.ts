import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

// npm run serve: the built dashboard (dist/) on localhost, with /data/* served
// from the latest tracker run in out/ (falling back to the snapshot in dist/data/).
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const dist = resolve("dist");
const out = resolve(process.env.OUT_DIR ?? "out");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const inside = (root: string, rel: string) => {
  const full = normalize(join(root, rel));
  return full === root || full.startsWith(root + "/") ? full : undefined;
};
const isFile = async (p: string | undefined) => (p ? (await stat(p).catch(() => undefined))?.isFile() === true : false);

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  let file: string | undefined;
  if (path.startsWith("/data/")) {
    const fromOut = inside(out, path.slice("/data/".length));
    file = (await isFile(fromOut)) ? fromOut : inside(dist, path);
  } else {
    file = inside(dist, path.endsWith("/") ? `${path}index.html` : path);
  }
  if (!file || !(await isFile(file))) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(await readFile(file));
});

if (!(await isFile(join(dist, "index.html")))) {
  console.error("dist/index.html is missing. Run npm run build first.");
  process.exit(1);
}
server.listen(port, host, () => console.log(`Dashboard on http://${host}:${port}/ (data from ${out})`));
