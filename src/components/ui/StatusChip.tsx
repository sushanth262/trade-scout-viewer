import styles from "./StatusChip.module.css";

const statusColors: Record<string, { bg: string; text: string }> = {
  submitted:       { bg: "var(--success-50)", text: "var(--success-700)" },
  dry_run:         { bg: "var(--info-50)",    text: "var(--info-700)" },
  skipped_not_rated: { bg: "#F5F5F5",         text: "#737373" },
  skipped_blocked:   { bg: "var(--warning-50)", text: "var(--warning-700)" },
  skipped_duplicate: { bg: "#F5F5F5",          text: "#737373" },
  skipped_insufficient_cash: { bg: "var(--warning-50)", text: "var(--warning-700)" },
  failed:          { bg: "var(--danger-50)",  text: "var(--danger-700)" },
  stop_triggered:  { bg: "var(--danger-50)",  text: "var(--danger-700)" },
  sell_logged:     { bg: "var(--info-50)",    text: "var(--info-700)" },
  BUY:             { bg: "var(--success-50)", text: "var(--success-700)" },
  WATCH:           { bg: "var(--warning-50)", text: "var(--warning-700)" },
  BULLISH:         { bg: "var(--success-50)", text: "var(--success-700)" },
  BEARISH:         { bg: "var(--danger-50)",  text: "var(--danger-700)" },
  NEUTRAL:         { bg: "#F5F5F5",           text: "#737373" },
  UNKNOWN:         { bg: "#F5F5F5",           text: "#9CA3AF" },
  "VERY HIGH":     { bg: "var(--success-50)", text: "var(--success-700)" },
  HIGH:            { bg: "var(--success-50)", text: "var(--success-700)" },
  MEDIUM:          { bg: "var(--warning-50)", text: "var(--warning-700)" },
  LOW:             { bg: "#F5F5F5",           text: "#737373" },
};

const fallback = { bg: "#F5F5F5", text: "#737373" };

export default function StatusChip({ status }: { status: string }) {
  const c = statusColors[status] ?? fallback;
  return (
    <span className={styles.chip} style={{ background: c.bg, color: c.text }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
