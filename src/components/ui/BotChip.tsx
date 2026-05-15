import styles from "./BotChip.module.css";

type BotKey = "copytrade" | "earnings-trade" | "earnings" | string | null | undefined;

const palette: Record<string, { bg: string; text: string; border: string; label: string }> = {
  "alpaca-only": {
    bg: "#F1F5F9",
    text: "#334155",
    border: "#CBD5E1",
    label: "alpaca-only",
  },
  copytrade: {
    bg: "#EEF2FF",
    text: "#1B2B65",
    border: "#C7D2FE",
    label: "copytrade",
  },
  "earnings-trade": {
    bg: "#FFFBEB",
    text: "#B45309",
    border: "#FDE68A",
    label: "earnings-trade",
  },
  "indicator-alert-bot": {
    bg: "#ECFDF5",
    text: "#047857",
    border: "#A7F3D0",
    label: "indicator-alert-bot",
  },
  earnings: {
    bg: "#FFFBEB",
    text: "#B45309",
    border: "#FDE68A",
    label: "earnings-trade",
  },
};

export default function BotChip({ bot }: { bot: BotKey }) {
  if (!bot) {
    return <span className={styles.empty}>—</span>;
  }
  const p = palette[bot] ?? {
    bg: "#F5F5F5",
    text: "#737373",
    border: "#E5E7EB",
    label: bot,
  };
  return (
    <span
      className={styles.chip}
      style={{ background: p.bg, color: p.text, borderColor: p.border }}
    >
      <span className={styles.dot} style={{ background: p.text }} />
      {p.label}
    </span>
  );
}
