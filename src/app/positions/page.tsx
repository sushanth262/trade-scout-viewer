"use client";
import { useEffect, useState, useCallback } from "react";
import Card from "@/components/ui/Card";
import StatusChip from "@/components/ui/StatusChip";
import { fetchApi, PaginatedResponse } from "@/lib/api";
import { TradeEvent } from "@/lib/cosmos";
import { TrendingUp, TrendingDown, Target, Activity } from "lucide-react";
import styles from "./page.module.css";

interface Position {
  ticker: string;
  entry_price: number;
  peak?: number;
  stop_level?: number;
  trail_pct?: number;
  current_gain_pct?: number;
  status: "open" | "closed";
  exit_price?: number;
  exit_timestamp?: string;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [stopEvents, setStopEvents] = useState<TradeEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [submittedRes, stopsRes] = await Promise.all([
        fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", { status: "submitted", limit: "100" }),
        fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", { event: "stop_triggered", limit: "100" }),
      ]);

      const closedSymbols = new Set(stopsRes.items.map((s) => s.symbol));
      setStopEvents(stopsRes.items);

      const posMap = new Map<string, Position>();
      for (const t of submittedRes.items) {
        if (!posMap.has(t.ticker)) {
          posMap.set(t.ticker, {
            ticker: t.ticker,
            entry_price: t.entry_price!,
            status: closedSymbols.has(t.ticker) ? "closed" : "open",
          });
        }
      }

      for (const s of stopsRes.items) {
        const pos = posMap.get(s.symbol!);
        if (pos) {
          pos.exit_price = s.price;
          pos.peak = s.peak;
          pos.stop_level = s.stop_level;
          pos.trail_pct = s.trail_pct;
          pos.exit_timestamp = s.timestamp;
          if (pos.entry_price && s.price) {
            pos.current_gain_pct = ((s.price - pos.entry_price) / pos.entry_price) * 100;
          }
        }
      }

      setPositions(Array.from(posMap.values()));
    } catch {
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPos = positions.filter((p) => p.status === "open");
  const closedPos = positions.filter((p) => p.status === "closed");

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Positions</h1>
      <p className={styles.subtitle}>Open and closed positions tracked by the trailing stop monitor</p>

      {loading ? (
        <Card><div className={styles.loading}><div className={styles.spinner} />Loading...</div></Card>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>
            <Activity size={16} /> Open Positions ({openPos.length})
          </h2>
          {openPos.length === 0 ? (
            <Card><p className={styles.emptyText}>No open positions</p></Card>
          ) : (
            <div className={styles.posGrid}>
              {openPos.map((p) => (
                <Card key={p.ticker} tint="info" className={styles.posCard}>
                  <div className={styles.posHeader}>
                    <span className={styles.ticker}>{p.ticker}</span>
                    <StatusChip status="submitted" />
                  </div>
                  <div className={styles.posMetrics}>
                    <div className={styles.posMetric}>
                      <span className={styles.posLabel}>Entry</span>
                      <span className={styles.posValue}>${p.entry_price.toFixed(2)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <h2 className={styles.sectionTitle}>
            <Target size={16} /> Closed Positions ({closedPos.length})
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
                        <span className={styles.posValue}>${p.entry_price.toFixed(2)}</span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Exit</span>
                        <span className={styles.posValue}>${p.exit_price?.toFixed(2) ?? "—"}</span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Peak</span>
                        <span className={styles.posValue}>${p.peak?.toFixed(2) ?? "—"}</span>
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
                        <span className={styles.posValue}>{p.trail_pct}%</span>
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
