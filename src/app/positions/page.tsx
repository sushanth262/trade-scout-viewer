"use client";
import { useEffect, useState, useCallback } from "react";
import Card from "@/components/ui/Card";
import StatusChip from "@/components/ui/StatusChip";
import InfoTip from "@/components/ui/InfoTip";
import { fetchApi, PaginatedResponse } from "@/lib/api";
import { TradeEvent, PositionState } from "@/lib/cosmos";
import { TrendingUp, TrendingDown, Target, Activity, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./page.module.css";

interface Position {
  ticker: string;
  bot?: string;
  qty?: string;
  entry_price?: number | null;
  current_price?: number;
  peak?: number;
  stop_level?: number;
  trail_pct?: number;
  current_gain_pct?: number;
  status: "open" | "closed";
  exit_price?: number;
  exit_timestamp?: string;
  updated_at?: string;
  politician?: string;
  size_label?: string;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [submittedRes, stopsRes, liveRes] = await Promise.all([
        fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", { status: "submitted", limit: "100" }),
        fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", { event: "stop_triggered", limit: "100" }),
        fetchApi<PaginatedResponse<PositionState>>("/api/positions").catch(() => ({ items: [], total: 0 })),
      ]);

      const closedSymbols = new Set(stopsRes.items.map((s) => s.symbol));

      // Build base map from "submitted" trade events (gives entry context).
      const posMap = new Map<string, Position>();
      for (const t of submittedRes.items) {
        if (!t.ticker) continue;
        if (!posMap.has(t.ticker)) {
          posMap.set(t.ticker, {
            ticker: t.ticker,
            entry_price: t.entry_price,
            status: closedSymbols.has(t.ticker) ? "closed" : "open",
            bot: t.bot,
            politician: t.politician,
            size_label: t.size_label,
          });
        }
      }

      // Merge in live snapshots from monitor.py — overrides entry/bot if
      // missing and adds current price, peak, stop, gain%, trail%.
      for (const live of liveRes.items) {
        const existing = posMap.get(live.ticker);
        if (existing) {
          existing.qty = live.qty ?? existing.qty;
          existing.entry_price = existing.entry_price ?? live.entry_price ?? undefined;
          existing.current_price = live.current_price;
          existing.peak = live.peak;
          existing.stop_level = live.stop_level;
          existing.trail_pct = live.trail_pct;
          existing.current_gain_pct = live.current_gain_pct;
          existing.bot = existing.bot ?? live.bot;
          existing.updated_at = live.updated_at;
          // A position with a live snapshot is by definition open.
          if (!closedSymbols.has(live.ticker)) existing.status = "open";
        } else if (!closedSymbols.has(live.ticker)) {
          // Open position that has no submitted-event in our window — still
          // surface it so the user sees what monitor.py is watching.
          posMap.set(live.ticker, {
            ticker: live.ticker,
            bot: live.bot,
            qty: live.qty,
            entry_price: live.entry_price ?? undefined,
            current_price: live.current_price,
            peak: live.peak,
            stop_level: live.stop_level,
            trail_pct: live.trail_pct,
            current_gain_pct: live.current_gain_pct,
            updated_at: live.updated_at,
            status: "open",
          });
        }
      }

      // Decorate closed positions with exit context.
      for (const s of stopsRes.items) {
        const sym = s.symbol;
        if (!sym) continue;
        const pos = posMap.get(sym);
        if (pos) {
          pos.exit_price = s.price;
          pos.peak = pos.peak ?? s.peak;
          pos.stop_level = pos.stop_level ?? s.stop_level;
          pos.trail_pct = pos.trail_pct ?? s.trail_pct;
          pos.exit_timestamp = s.timestamp;
          if (pos.entry_price && s.price) {
            pos.current_gain_pct = ((s.price - pos.entry_price) / pos.entry_price) * 100;
          }
        }
      }

      setPositions(Array.from(posMap.values()));
      setLastRefreshed(new Date());
    } catch {
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s so open-position numbers stay live.
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const openPos = positions.filter((p) => p.status === "open");
  const closedPos = positions.filter((p) => p.status === "closed");

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Positions</h1>
      <p className={styles.subtitle}>
        Open positions update every 5 minutes from the monitor cycle
        {lastRefreshed && ` · refreshed ${formatDistanceToNow(lastRefreshed, { addSuffix: true })}`}
      </p>

      {loading && positions.length === 0 ? (
        <Card><div className={styles.loading}><div className={styles.spinner} />Loading...</div></Card>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>
            <Activity size={16} /> Open Positions ({openPos.length})
            <InfoTip text="Positions the bot currently holds — refreshed every 5 minutes by monitor.py. 'Current' is the live Alpaca price. 'Peak' is the highest price since you bought it (used to anchor the trailing stop). 'Stop' is the price that will trigger an automatic sell. 'Gain' is unrealized P&L." />
            <button
              type="button"
              onClick={load}
              disabled={loading}
              style={{ marginLeft: "auto", background: "transparent", border: "1px solid var(--border-light)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}
            >
              <RefreshCw size={12} style={{ animation: loading ? "spin 0.8s linear infinite" : "none" }} /> Refresh
            </button>
          </h2>
          {openPos.length === 0 ? (
            <Card><p className={styles.emptyText}>No open positions</p></Card>
          ) : (
            <div className={styles.posGrid}>
              {openPos.map((p) => {
                const gain = p.current_gain_pct ?? 0;
                const tint = gain >= 0 ? "success" : "danger";
                return (
                  <Card key={p.ticker} tint={tint} className={styles.posCard}>
                    <div className={styles.posHeader}>
                      <span className={styles.ticker}>{p.ticker}</span>
                      <StatusChip status="submitted" />
                    </div>
                    <div className={styles.posMetrics}>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Entry</span>
                        <span className={styles.posValue}>
                          {p.entry_price != null ? `$${p.entry_price.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Current</span>
                        <span className={styles.posValue}>
                          {p.current_price != null ? `$${p.current_price.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Peak</span>
                        <span className={styles.posValue}>
                          {p.peak != null ? `$${p.peak.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Stop</span>
                        <span className={styles.posValue}>
                          {p.stop_level != null ? `$${p.stop_level.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Gain</span>
                        <span className={`${styles.posValue} ${gain >= 0 ? styles.gainUp : styles.gainDown}`}>
                          {p.current_gain_pct != null ? (
                            <>
                              {gain >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                              {gain.toFixed(1)}%
                            </>
                          ) : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Trail</span>
                        <span className={styles.posValue}>
                          {p.trail_pct != null ? `${p.trail_pct}%` : "—"}
                        </span>
                      </div>
                      {p.qty && (
                        <div className={styles.posMetric}>
                          <span className={styles.posLabel}>Qty</span>
                          <span className={styles.posValue}>{p.qty}</span>
                        </div>
                      )}
                      {p.size_label && (
                        <div className={styles.posMetric}>
                          <span className={styles.posLabel}>Size</span>
                          <span className={styles.posValue}>{p.size_label}</span>
                        </div>
                      )}
                      {p.bot && (
                        <div className={styles.posMetric}>
                          <span className={styles.posLabel}>Bot</span>
                          <span className={styles.posValue}>{p.bot}</span>
                        </div>
                      )}
                      {p.politician && (
                        <div className={styles.posMetric}>
                          <span className={styles.posLabel}>Politician</span>
                          <span className={styles.posValue}>{p.politician}</span>
                        </div>
                      )}
                    </div>
                    {p.updated_at && (
                      <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 8 }}>
                        Updated {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          <h2 className={styles.sectionTitle}>
            <Target size={16} /> Closed Positions ({closedPos.length})
            <InfoTip text="Positions that have been sold — either the trailing stop fired or the bot manually closed them. P&L is realized." />
          </h2>
          {closedPos.length === 0 ? (
            <Card><p className={styles.emptyText}>No closed positions</p></Card>
          ) : (
            <div className={styles.posGrid}>
              {closedPos.map((p) => {
                const gain = p.current_gain_pct ?? 0;
                const tint = gain >= 0 ? "success" : "danger";
                return (
                  <Card key={p.ticker} tint={tint} className={styles.posCard}>
                    <div className={styles.posHeader}>
                      <span className={styles.ticker}>{p.ticker}</span>
                      <StatusChip status="stop_triggered" />
                    </div>
                    <div className={styles.posMetrics}>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Entry</span>
                        <span className={styles.posValue}>
                          {p.entry_price != null ? `$${p.entry_price.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Exit</span>
                        <span className={styles.posValue}>
                          {p.exit_price != null ? `$${p.exit_price.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Peak</span>
                        <span className={styles.posValue}>
                          {p.peak != null ? `$${p.peak.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>P&L</span>
                        <span className={`${styles.posValue} ${gain >= 0 ? styles.gainUp : styles.gainDown}`}>
                          {gain >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          {gain.toFixed(1)}%
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Trail</span>
                        <span className={styles.posValue}>{p.trail_pct != null ? `${p.trail_pct}%` : "—"}</span>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
