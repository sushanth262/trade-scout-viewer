"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  ArrowRightLeft,
  Radar,
  TrendingUp,
  ScrollText,
  LineChart as LineChartIcon,
  Sparkles,
  Bookmark,
} from "lucide-react";
import styles from "./MobileNav.module.css";

const items = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ArrowRightLeft },
  { href: "/signals", label: "Signals", icon: Radar },
  { href: "/positions", label: "Positions", icon: TrendingUp },
  { href: "/watchlist", label: "Watch", icon: Bookmark },
  { href: "/runs", label: "Runs", icon: LineChartIcon },
  { href: "/summary", label: "Summary", icon: Sparkles },
  { href: "/logs", label: "Logs", icon: ScrollText },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.bar}>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={`${styles.item} ${active ? styles.active : ""}`}>
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
