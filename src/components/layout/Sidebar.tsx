"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  LayoutDashboard,
  ArrowRightLeft,
  Radar,
  TrendingUp,
  Activity,
  ScrollText,
  LineChart as LineChartIcon,
  Sparkles,
  Settings,
  Bookmark,
} from "lucide-react";
import styles from "./Sidebar.module.css";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trade Log", icon: ArrowRightLeft },
  { href: "/signals", label: "Signals", icon: Radar },
  { href: "/positions", label: "Positions", icon: TrendingUp },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/activity", label: "Activity Feed", icon: Activity },
  { href: "/runs", label: "Job Runs", icon: LineChartIcon },
  { href: "/summary", label: "Transactions Summary", icon: Sparkles },
  { href: "/logs", label: "Bot Logs", icon: ScrollText },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoWrap}>
        <div className={styles.logoBg}>
          <Image src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.svg`} alt="TradeHawk" width={120} height={120} unoptimized />
        </div>
        <div className={styles.tagline}>
          <span className={styles.taglineWord}>Track</span>
          <span className={styles.taglineDot}>·</span>
          <span className={styles.taglineWord}>Analyze</span>
          <span className={styles.taglineDot}>·</span>
          <span className={styles.taglineWord}>Position</span>
        </div>
      </div>

      <nav className={styles.nav}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.navItem} ${active ? styles.active : ""}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <Settings size={14} />
        <span>TradeHawk v0.1</span>
      </div>
    </aside>
  );
}
