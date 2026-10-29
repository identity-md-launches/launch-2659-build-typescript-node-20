import { useCallback, useEffect, useMemo, useState } from "react";
import { ALERT_LABELS, EXPLORER, count, duration, shortHash, when } from "./format.ts";
import type { Alert, Severity, Summary } from "./types.ts";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; summary: Summary };

const PAGE = 15;
const DATA = "./data/";

export function App() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchSummary = useCallback(async () => {
    setLoad((l) => (l.state === "ready" ? l : { state: "loading" }));
    try {
      const res = await fetch(`${DATA}summary.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(`summary.json returned HTTP ${res.status}`);
      setLoad({ state: "ready", summary: (await res.json()) as Summary });
    } catch (error) {
      setLoad({ state: "error", message: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  return (
    <>
      <a className="skip" href="#alerts">
        Skip to alerts
      </a>
      <header className="top">
        <div className="wrap top-row">
          <div>
            <h1>Squeekchain settlement latency</h1>
            <p className="lede">How long SqueekCore takes to settle closed rounds on Sepolia, read at one finalized block.</p>
          </div>
          <button type="button" className="button" onClick={() => void fetchSummary()}>
            Reload data
          </button>
        </div>
      </header>
      <main className="wrap">
        {load.state === "loading" && <p className="notice" role="status">Loading the latest tracker run…</p>}
        {load.state === "error" && (
          <div className="notice notice-critical" role="alert">
            <h2>No tracker data yet</h2>
            <p>
              The dashboard could not read <code>data/summary.json</code> ({load.message}). Run <code>npm run track</code>, then{" "}
              <code>npm run serve</code>, and reload.
            </p>
          </div>
        )}
        {load.state === "ready" && <Dashboard summary={load.summary} />}
      </main>
    </>
  );
}

function Dashboard({ summary: s }: { summary: Summary }) {
  const { now, stats, thresholds: th } = s;
  const stalled = now.unsettledClosedRounds > th.unsettledRounds;
  const tone: Severity = now.paused || !s.verification.ok ? "critical" : stalled ? "warning" : "info";
  const headline = !s.verification.ok
    ? "Deployment checks failed"
    : now.paused
      ? "Settlement is paused"
      : stalled
        ? `Settlement is behind by ${count(now.unsettledClosedRounds)} rounds`
        : "Settlement is keeping up";

  return (
    <>
      <section className={`status status-${tone}`} aria-labelledby="status-title">
        <h2 id="status-title">{headline}</h2>
        <p className="status-line">
          {now.unsettledClosedRounds > 0
            ? `Oldest unsettled round closed ${duration(now.oldestUnsettledWaitSec)} before block ${count(Number(s.pinnedBlock.number))}.`
            : `Every closed round is settled at block ${count(Number(s.pinnedBlock.number))}.`}
        </p>
        <dl className="metrics">
          <Metric label="Unsettled closed rounds" value={count(now.unsettledClosedRounds)} />
          <Metric label="Frontier / current round" value={`${count(now.settledThroughRound)} / ${count(now.currentRound)}`} />
          <Metric label="Median oldest-round latency" value={duration(stats.oldestLatencySec.p50)} />
          <Metric label="Mining lag" value={`${count(now.miningLagRounds)} rounds`} />
        </dl>
        <a className="button button-primary" href="#alerts">
          Review {count(s.recentAlerts.length)} alerts
        </a>
      </section>

      <Alerts alerts={s.recentAlerts} counts={s.alertCounts} />
      <LatencyChart summary={s} />
      <Daily summary={s} />
      <Downloads />
      <Verification summary={s} />
      <footer className="foot">
        <p>
          Pinned {s.pinnedBlock.tag} block{" "}
          <a href={`${EXPLORER}/block/${s.pinnedBlock.number}`}>{count(Number(s.pinnedBlock.number))}</a> at{" "}
          {when(s.pinnedBlock.timestamp)}, hash <code title={s.pinnedBlock.hash}>{shortHash(s.pinnedBlock.hash)}</code>. Replayed{" "}
          {count(s.replay.logs)} logs from block {count(Number(s.replay.fromBlock))}. Generated {when(s.generatedAt)}.
        </p>
        <p>
          Read-only: no wallet, no keys. Deployment record {s.release}. Docs at{" "}
          <a href="https://docs.squeekchain.com/developers/">docs.squeekchain.com/developers</a>.
        </p>
      </footer>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Alerts({ alerts, counts }: { alerts: Alert[]; counts: Record<string, number> }) {
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(
    () => alerts.filter((a) => (type === "all" || a.type === type) && (severity === "all" || a.severity === severity)),
    [alerts, type, severity],
  );
  useEffect(() => setShown(PAGE), [type, severity]);
  const visible = filtered.slice(0, shown);

  return (
    <section id="alerts" className="section" aria-labelledby="alerts-title" tabIndex={-1}>
      <h2 id="alerts-title">Recent alerts</h2>
      <div className="filters">
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            {Object.keys(ALERT_LABELS).map((k) => (
              <option key={k} value={k}>
                {ALERT_LABELS[k]} ({counts[k] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <fieldset className="segmented">
          <legend>Severity</legend>
          {(["all", "critical", "warning", "info"] as const).map((v) => (
            <label key={v}>
              <input type="radio" name="severity" value={v} checked={severity === v} onChange={() => setSeverity(v)} />
              <span>{v === "all" ? "All" : v[0]!.toUpperCase() + v.slice(1)}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <p className="count" role="status">
        {filtered.length === 0 ? "No alerts match these filters." : `Showing ${visible.length} of ${filtered.length} alerts, newest first.`}
      </p>
      <ol className="alerts">
        {visible.map((a, i) => (
          <li key={`${a.txHash}-${a.type}-${i}`} className="alert">
            <div className="alert-head">
              <span className={`badge badge-${a.severity}`}>{a.severity[0]!.toUpperCase() + a.severity.slice(1)}</span>
              <span className="alert-type" title={a.type}>
                {ALERT_LABELS[a.type] ?? a.type}
              </span>
              <time dateTime={a.timestamp}>{when(a.timestamp)}</time>
            </div>
            <p className="alert-msg">{a.message}</p>
            <p className="alert-meta">
              Block <a href={`${EXPLORER}/block/${a.blockNumber}`}>{count(Number(a.blockNumber))}</a>
              {a.txHash && (
                <>
                  {" "}
                  · <a href={`${EXPLORER}/tx/${a.txHash}`}>transaction {shortHash(a.txHash)}</a>
                </>
              )}
            </p>
          </li>
        ))}
      </ol>
      {filtered.length > shown && (
        <button type="button" className="button" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, filtered.length - shown)} more
        </button>
      )}
    </section>
  );
}

function LatencyChart({ summary: s }: { summary: Summary }) {
  const bars = s.recentBatches;
  if (bars.length === 0) return null;
  const th = s.thresholds.latencySec;
  // Log scale so a 36s settlement and a 36h stall both stay readable.
  const top = Math.log10(Math.max(th * 4, ...bars.map((b) => b.oldestLatencySec), 10));
  const y = (sec: number) => 100 - (Math.log10(Math.max(sec, 1)) / top) * 100;
  const w = 100 / bars.length;
  const over = bars.filter((b) => b.oldestLatencySec > th).length;
  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  return (
    <section className="section" aria-labelledby="chart-title">
      <h2 id="chart-title">Oldest-round latency, last {bars.length} batches</h2>
      <figure className="chart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-labelledby="chart-cap">
          {bars.map((b, i) => (
            <rect
              key={b.index}
              x={i * w + w * 0.15}
              width={w * 0.7}
              y={y(b.oldestLatencySec)}
              height={100 - y(b.oldestLatencySec)}
              className={b.oldestLatencySec > th ? "bar bar-over" : "bar"}
            />
          ))}
          <line x1="0" x2="100" y1={y(th)} y2={y(th)} className="limit" vectorEffect="non-scaling-stroke" />
        </svg>
        <figcaption id="chart-cap">
          Batches {count(first.index)} to {count(last.index)} ({when(first.timestamp)} to {when(last.timestamp)}). Log scale; the line marks
          the {duration(th)} alert threshold. {over === 0 ? "No batch crossed it." : `${over} batches crossed it.`} Overall p90 is{" "}
          {duration(s.stats.oldestLatencySec.p90)}, maximum {duration(s.stats.oldestLatencySec.max)}.
        </figcaption>
      </figure>
    </section>
  );
}

function Daily({ summary: s }: { summary: Summary }) {
  const rows = [...s.daily].reverse();
  return (
    <section className="section" aria-labelledby="daily-title">
      <h2 id="daily-title">Daily settlement</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="daily-title">
        <table>
          <thead>
            <tr>
              <th scope="col">Date (UTC)</th>
              <th scope="col">Batches</th>
              <th scope="col">Rounds</th>
              <th scope="col">Median latency</th>
              <th scope="col">Max latency</th>
              <th scope="col">Max gap</th>
              <th scope="col">Alerts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date} className={d.batches === 0 ? "row-empty" : undefined}>
                <th scope="row">{d.date}</th>
                <td>{count(d.batches)}</td>
                <td>{count(d.roundsSettled)}</td>
                <td>{d.batches ? duration(d.medianOldestLatencySec) : "none"}</td>
                <td>{d.batches ? duration(d.maxOldestLatencySec) : "none"}</td>
                <td>{d.batches ? duration(d.maxGapSec) : "none"}</td>
                <td>{count(d.alerts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Downloads() {
  const files = [
    ["batches.csv", "Every BatchSettled with latency and gap"],
    ["alerts.csv", "Every alert raised by the replay"],
    ["daily.csv", "One row per UTC day"],
    ["summary.json", "Pinned block, checks and totals"],
  ];
  return (
    <section className="section" aria-labelledby="files-title">
      <h2 id="files-title">Download the outputs</h2>
      <ul className="files">
        {files.map(([name, note]) => (
          <li key={name}>
            <a className="button" href={`${DATA}${name}`} download>
              Download {name}
            </a>
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Verification({ summary: s }: { summary: Summary }) {
  const failed = s.verification.checks.filter((c) => !c.ok).length;
  return (
    <section className="section" aria-labelledby="verify-title">
      <h2 id="verify-title">Deployment checks</h2>
      <p>
        {failed === 0
          ? `All ${s.verification.checks.length} Quickstart checks passed at the pinned block, so the replay ran.`
          : `${failed} of ${s.verification.checks.length} checks failed; the tracker stopped.`}
      </p>
      <details className="checks">
        <summary>Show every check</summary>
        <ul>
          {s.verification.checks.map((c) => (
            <li key={`${c.group}-${c.name}`}>
              <span className={`badge badge-${c.ok ? "info" : "critical"}`}>{c.ok ? "Pass" : "Fail"}</span> {c.group}: {c.name}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
