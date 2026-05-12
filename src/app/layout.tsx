import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import MobileNav from "@/components/layout/MobileNav";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: "TradeHawk | Trade Scout Viewer",
  description: "Trade task and transaction log viewer for earnings-trade bot",
  icons: { icon: "/icon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className={styles.shell}>
          <Sidebar />
          <main className={styles.main}>{children}</main>
          <MobileNav />
        </div>
      </body>
    </html>
  );
}
