import { ReactNode, CSSProperties } from "react";
import styles from "./Card.module.css";

type Tint = "success" | "warning" | "danger" | "info" | "none";

const tintBg: Record<Tint, string> = {
  success: "var(--success-50)",
  warning: "var(--warning-50)",
  danger: "var(--danger-50)",
  info: "var(--info-50)",
  none: "var(--surface)",
};

interface Props {
  children: ReactNode;
  tint?: Tint;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export default function Card({ children, tint = "none", className = "", style, onClick }: Props) {
  return (
    <div
      className={`${styles.card} ${className}`}
      style={{ background: tintBg[tint], ...style }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
