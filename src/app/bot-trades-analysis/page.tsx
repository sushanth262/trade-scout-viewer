"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, PieChart } from "lucide-react";
import Card from "@/components/ui/Card";
import BotChip from "@/components/ui/BotChip";
import { fetchOpenPositionsByBot, type EnrichedBotPosition } from "@/lib/bot-open-positions";
import styles from "./page.module.css";

export default function BotTradesAnalysisPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [posByBot, setPosByBot] = useState<Map<string, EnrichedBotPosition[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const m = await fetchOpenPositionsByBot(basePath);
      setPosByBot(m);
    } catch {
      setPosByBot(new Map());
    }
  }, [basePath]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = async () => {
    setLoading(true);
    await load();
    setLoading(false);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>
        <PieChart size={24} style={{ verticalAlign: "middle", marginRight: 8 }} />
        Bot Trades Analysis
      </h1>
      <p className={styles.subtitle}>
        Open holdings attributed to each bot from position snapshots, merged with Alpaca unrealized P&L when
        available. Tickers live in one portfolio — per-bot rows mirror your Position Snapshots UI.
      </p>
      <p className={styles.crossLink}>
        <Link href={`${basePath}/orders`}>View Alpaca orders (with bot filters) →</Link>
      </p>

      <div className={styles.toolbar}>
        <button type="button" className={styles.refreshBtn} onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
          Refresh
        </button>
      </div>

      {loading && posByBot.size === 0 ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          Loading positions…
        </div>
      ) : (
        <div className={styles.botCards}>
          {[...posByBot.entries()].map(([botKey, positions]) => {
            const unrealized = positions.reduce((s, p) => s + (p.unrealized_pl ?? 0), 0);
            const mv = positions.reduce((s, p) => s + (p.market_value ?? 0), 0);
            const hasPl = positions.some((p) => p.unrealized_pl != null);

            return (
              <div key={botKey} className={styles.botCard}>
                <h3>
                  {botKey === "alpaca-only" ? (
                    <span>Alpaca (no snapshot)</span>
                  ) : (
                    <BotChip bot={botKey} />
                  )}
                  <span className={styles.count}>{positions.length} sym</span>
                </h3>
                <div className={styles.totals}>
                  {hasPl ? (
                    <span className={unrealized >= 0 ? styles.positive : styles.negative}>
                      Unrealized {unrealized >= 0 ? "+" : ""}
                      ${unrealized.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  ) : (
                    <span>Est. MV ${mv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  )}
                </div>
                {positions.length === 0 ? (
                  <p className={styles.posEmpty}>No open rows.</p>
                ) : (
                  <table className={styles.posTable}>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Gain%</th>
                        <th>Unreal.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={p.ticker}>
                          <td>
                            <Link href={`${basePath}/chart/${encodeURIComponent(p.ticker)}`}>{p.ticker}</Link>
                          </td>
                          <td
                            className={
                              (p.current_gain_pct ?? 0) >= 0 ? styles.positive : styles.negative
                            }
                          >
                            {p.current_gain_pct != null && Number.isFinite(p.current_gain_pct)
                              ? `${p.current_gain_pct >= 0 ? "+" : ""}${p.current_gain_pct.toFixed(1)}%`
                              : "—"}
                          </td>
                          <td
                            className={
                              (p.unrealized_pl ?? 0) >= 0 ? styles.positive : styles.negative
                            }
                          >
                            {p.unrealized_pl != null && Number.isFinite(p.unrealized_pl)
                              ? `${p.unrealized_pl >= 0 ? "+" : ""}$${p.unrealized_pl.toFixed(0)}`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {posByBot.size === 0 && !loading ? (
        <Card>
          <p className={styles.posEmpty}>
            No position snapshots yet. Run monitor tasks or refresh after market open.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
