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
  Wallet2,
  Joystick,
  ClipboardList,
  PieChart,
} from "lucide-react";
import styles from "./MobileNav.module.css";

const items = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ArrowRightLeft },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/bot-trades-analysis", label: "Bot P&L", icon: PieChart },
  { href: "/signals", label: "Signals", icon: Radar },
  { href: "/positions", label: "Positions", icon: TrendingUp },
  { href: "/watchlist", label: "Watch", icon: Bookmark },
  { href: "/balances", label: "$", icon: Wallet2 },
  { href: "/runs", label: "Runs", icon: LineChartIcon },
  { href: "/summary", label: "Summary", icon: Sparkles },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/bot-actions", label: "Bots", icon: Joystick },
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
