export const ALERT_LABELS: Record<string, string> = {
  SETTLEMENT_LATENCY: "Settlement latency",
  BATCH_GAP: "Batch gap",
  UNSETTLED_NOW: "Unsettled now",
  FRONTIER_DISCONTINUITY: "Frontier discontinuity",
  NONCE_JUMP: "Nonce jump",
  PAUSED: "Paused",
  UNPAUSED: "Unpaused",
  REPORTER_ROTATED: "Reporter rotated",
  MINING_CHECKPOINT_LAG: "Mining checkpoint lag",
};

export const EXPLORER = "https://eth-sepolia.blockscout.com";

export const duration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
export const when = (iso: string) => `${dateTime.format(new Date(iso))} UTC`;

export const count = (n: number) => n.toLocaleString("en-US");

export const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);
