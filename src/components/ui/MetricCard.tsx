import Card from "./Card";
import InfoTip from "./InfoTip";
import styles from "./MetricCard.module.css";

type Tint = "success" | "warning" | "danger" | "info" | "none";

interface Props {
  label: string;
  value: string | number;
  delta?: string;
  deltaType?: "up" | "down" | "neutral";
  tint?: Tint;
  icon?: React.ReactNode;
  help?: string;
}

export default function MetricCard({ label, value, delta, deltaType = "neutral", tint = "none", icon, help }: Props) {
  return (
    <Card tint={tint} className={styles.metric}>
      <div className={styles.header}>
        <span className={styles.label}>
          {label}
          {help && <InfoTip text={help} />}
        </span>
        {icon && <span className={styles.icon}>{icon}</span>}
      </div>
      <div className={styles.value}>{value}</div>
      {delta && (
        <span className={`${styles.delta} ${styles[deltaType]}`}>
          {deltaType === "up" ? "↑" : deltaType === "down" ? "↓" : "→"} {delta}
        </span>
      )}
    </Card>
  );
}
