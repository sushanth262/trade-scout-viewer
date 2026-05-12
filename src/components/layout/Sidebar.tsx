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
  Settings,
} from "lucide-react";
import styles from "./Sidebar.module.css";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trade Log", icon: ArrowRightLeft },
  { href: "/signals", label: "Signals", icon: Radar },
  { href: "/positions", label: "Positions", icon: TrendingUp },
  { href: "/activity", label: "Activity Feed", icon: Activity },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoWrap}>
        <div className={styles.logoBg}>
          <Image src="/icon.png" alt="my-scoutify" width={32} height={32} />
        </div>
        <span className={styles.appName}>my-scoutify</span>
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
        <span>Trade Scout v0.1</span>
      </div>
    </aside>
  );
}
