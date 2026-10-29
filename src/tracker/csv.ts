// Minimal RFC 4180 CSV: quote a field only when it needs it.
const field = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<T extends object>(rows: T[], columns: (keyof T & string)[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => field(row[c])).join(","));
  return `${lines.join("\n")}\n`;
}
