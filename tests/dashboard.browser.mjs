// Optional production-export regression check. Install Playwright externally,
// then set IMD_PLAYWRIGHT to its index.mjs (see README.md).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const playwright = process.env.IMD_PLAYWRIGHT
  ? await import(pathToFileURL(process.env.IMD_PLAYWRIGHT).href)
  : await import("playwright");
const engine = process.env.TEST_BROWSER ?? "chromium";
assert.ok(engine === "chromium" || engine === "webkit", "TEST_BROWSER must be chromium or webkit");
const dist = resolve("dist");
const snapshot = JSON.parse(await readFile(resolve(dist, "data/summary.json"), "utf8"));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    assert.ok(path.startsWith("/preview/"));
    const file = resolve(dist, path.slice("/preview/".length) || "index.html");
    assert.ok(file.startsWith(dist + sep));
    const content = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
let browser;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const luminance = (rgb) => {
  const linear = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

try {
  browser = await playwright[engine].launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, acceptDownloads: true });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator("#status-title").waitFor();
    const headline = await page.locator("#status-title").innerText();
    check(await page.locator(".alert").count() === Math.min(15, snapshot.recentAlerts.length), `${width}: initial alerts`);
    const action = await page.locator(".button-primary").boundingBox();
    check(action.y >= 0 && action.y + action.height <= 844, `${width}: primary action is on the first screen`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no page overflow`);
    const colors = await page.evaluate(() => ({
      fill: getComputedStyle(document.querySelector(".bar:not(.bar-over)")).fill,
      background: getComputedStyle(document.querySelector(".chart svg")).backgroundColor,
    }));
    const pair = [luminance(colors.fill), luminance(colors.background)].sort((a, b) => b - a);
    const contrast = (pair[0] + 0.05) / (pair[1] + 0.05);
    check(contrast >= 3, `${width}: chart contrast ${contrast} must be at least 3:1`);

    await page.locator(".button-primary").click();
    check(new URL(page.url()).hash === "#alerts", `${width}: Review alerts jump`);
    if (snapshot.recentAlerts.length > 15) {
      await page.getByRole("button", { name: /^Show \d+ more$/ }).click();
      check(await page.locator(".alert").count() === Math.min(30, snapshot.recentAlerts.length), `${width}: paging`);
    }
    await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("PAUSED");
    check(await page.locator(".alert").count() === snapshot.recentAlerts.filter((a) => a.type === "PAUSED").length, `${width}: type filter`);
    await page.getByRole("radio", { name: "Critical", exact: true }).check();
    await page.getByText("No alerts match these filters.", { exact: true }).waitFor();
    check(await page.locator(".alert").count() === 0, `${width}: severity filter and empty state`);
    await page.getByRole("radio", { name: "All", exact: true }).check();
    await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("all");

    const before = await page.locator("#status-title").elementHandle();
    await page.route("**/data/summary.json", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.getByRole("button", { name: "Reload data" }).click();
    await page.getByRole("alert").filter({ hasText: "Could not reload data. Showing the previous snapshot." }).waitFor();
    check(await page.locator("#status-title").innerText() === headline, `${width}: failed refresh preserves summary`);
    check(await before.evaluate((node) => node.isConnected), `${width}: failed refresh keeps the dashboard mounted`);
    check(await page.locator(".alert").count() === Math.min(15, snapshot.recentAlerts.length), `${width}: failed refresh preserves alerts`);
    check(await page.getByRole("link", { name: /^Download / }).count() === 4, `${width}: failed refresh preserves downloads`);

    await page.unroute("**/data/summary.json");
    await page.getByRole("button", { name: "Reload data" }).click();
    await page.getByRole("alert").waitFor({ state: "detached" });
    check(await page.locator("#status-title").innerText() === headline, `${width}: retry succeeds and clears error`);
    await page.locator(".checks summary").click();
    check(await page.locator(".checks[open] li").count() === snapshot.verification.checks.length, `${width}: deployment checks disclosure`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download batches.csv", exact: true }).click();
    check((await download).suggestedFilename() === "batches.csv", `${width}: download interaction`);
    check(errors.length === 0, `${width}: no script errors: ${errors.join(", ")}`);
    console.log(`${engine} ${width}×844: chart contrast ${contrast.toFixed(3)}:1, refresh failure/retry and primary interactions passed`);
    await page.close();
  }
  const firstLoad = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await firstLoad.route("**/data/summary.json", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await firstLoad.goto(url);
  await firstLoad.getByRole("heading", { name: "No tracker data yet" }).waitFor();
  check(await firstLoad.locator("#status-title").count() === 0, "first-load failure uses the full-page error");
  await firstLoad.unroute("**/data/summary.json");
  await firstLoad.getByRole("button", { name: "Reload data" }).click();
  await firstLoad.locator("#status-title").waitFor();
  check(await firstLoad.getByRole("alert").count() === 0, "first-load retry recovers");
  console.log(`${checks} browser checks passed using ${engine}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
