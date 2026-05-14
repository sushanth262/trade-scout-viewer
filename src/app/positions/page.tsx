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
  /** "alpaca" when row is filled from Alpaca API only (not bot trade log). */
  source?: string;
}

type ExchangePosRes = {
  configured?: boolean;
  open?: {
    symbol: string;
    qty: string;
    avg_entry_price: string;
    current_price: string;
    unrealized_plpc: string;
    market_value: string;
  }[];
  closedSells?: { symbol: string; qty: string; exit_price: number; filled_at: string | null }[];
};

function up(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function parsePlc(s: string | undefined): number | undefined {
  const u = parseFloat(s ?? "");
  if (!Number.isFinite(u)) return undefined;
  if (Math.abs(u) <= 1 && u !== 0) return u * 100;
  return u;
}

export default function PositionsPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let exRes: ExchangePosRes = {};
      try {
        const r = await fetch(`${basePath}/api/alpaca/exchange-positions`);
        exRes = (await r.json()) as ExchangePosRes;
      } catch {
        exRes = {};
      }

      const [submittedRes, stopsRes, liveRes] = await Promise.all([
        fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", { status: "submitted", limit: "100" }),
        fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", { event: "stop_triggered", limit: "100" }),
        fetchApi<PaginatedResponse<PositionState>>("/api/positions").catch(() => ({ items: [], total: 0 })),
      ]);

      const closedSymbols = new Set(stopsRes.items.map((s) => up(s.symbol)));

      const posMap = new Map<string, Position>();
      for (const t of submittedRes.items) {
        const tick = up(t.ticker);
        if (!tick) continue;
        if (!posMap.has(tick)) {
          posMap.set(tick, {
            ticker: tick,
            entry_price: t.entry_price,
            status: closedSymbols.has(tick) ? "closed" : "open",
            bot: t.bot,
            politician: t.politician,
            size_label: t.size_label,
          });
        }
      }

      for (const live of liveRes.items) {
        const tick = up(live.ticker);
        if (!tick) continue;
        const existing = posMap.get(tick);
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
          if (!closedSymbols.has(tick)) existing.status = "open";
        } else if (!closedSymbols.has(tick)) {
          posMap.set(tick, {
            ticker: tick,
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

      for (const s of stopsRes.items) {
        const sym = up(s.symbol);
        if (!sym) continue;
        let pos = posMap.get(sym);
        if (!pos) {
          pos = {
            ticker: sym,
            status: "closed",
            bot: s.bot,
          };
          posMap.set(sym, pos);
        }
        pos.exit_price = s.price;
        pos.peak = pos.peak ?? s.peak;
        pos.stop_level = pos.stop_level ?? s.stop_level;
        pos.trail_pct = pos.trail_pct ?? s.trail_pct;
        pos.exit_timestamp = s.timestamp;
        pos.status = "closed";
        if (pos.entry_price && s.price) {
          pos.current_gain_pct = ((s.price - pos.entry_price) / pos.entry_price) * 100;
        }
      }

      const alpacaMerge = exRes.configured === true;

      if (alpacaMerge && Array.isArray(exRes.open)) {
        for (const ap of exRes.open) {
          const sym = up(ap.symbol);
          if (!sym) continue;
          if (posMap.has(sym)) continue;
          const entry = parseFloat(ap.avg_entry_price) || undefined;
          const cur = parseFloat(ap.current_price) || undefined;
          const plc = parsePlc(ap.unrealized_plpc);
          posMap.set(sym, {
            ticker: sym,
            bot: "alpaca",
            qty: ap.qty,
            entry_price: entry,
            current_price: cur,
            current_gain_pct: plc,
            status: "open",
            source: "alpaca",
          });
        }
      }

      if (alpacaMerge && Array.isArray(exRes.closedSells)) {
        for (const cs of exRes.closedSells) {
          const sym = up(cs.symbol);
          if (!sym) continue;
          if (closedSymbols.has(sym)) continue;
          if (posMap.has(sym)) continue;
          posMap.set(sym, {
            ticker: sym,
            status: "closed",
            exit_price: cs.exit_price,
            exit_timestamp: cs.filled_at ?? undefined,
            qty: cs.qty,
            bot: "alpaca",
            source: "alpaca",
          });
        }
      }

      setPositions(Array.from(posMap.values()));
      setLastRefreshed(new Date());
    } catch {
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    load();
  }, [load]);

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
        Bot rows from trade log + live snapshots; Alpaca fills in any open/closed positions missing from that set.
        {lastRefreshed && ` · refreshed ${formatDistanceToNow(lastRefreshed, { addSuffix: true })}`}
      </p>

      {loading && positions.length === 0 ? (
        <Card>
          <div className={styles.loading}>
            <div className={styles.spinner} />
            Loading...
          </div>
        </Card>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>
            <Activity size={16} /> Open Positions ({openPos.length})
            <InfoTip text="Open rows from submitted trades + monitor snapshots, plus any open holding at Alpaca not already listed. Alpaca-only rows are tagged." />
            <button
              type="button"
              onClick={load}
              disabled={loading}
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "1px solid var(--border-light)",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-secondary)",
              }}
            >
              <RefreshCw size={12} style={{ animation: loading ? "spin 0.8s linear infinite" : "none" }} /> Refresh
            </button>
          </h2>
          {openPos.length === 0 ? (
            <Card>
              <p className={styles.emptyText}>No open positions</p>
            </Card>
          ) : (
            <div className={styles.posGrid}>
              {openPos.map((p) => {
                const gain = p.current_gain_pct ?? 0;
                const tint = gain >= 0 ? "success" : "danger";
                return (
                  <Card key={p.ticker} tint={tint} className={styles.posCard}>
                    <div className={styles.posHeader}>
                      <span className={styles.ticker}>{p.ticker}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {p.source === "alpaca" && <span className={styles.badge}>Alpaca</span>}
                        <StatusChip status="submitted" />
                      </div>
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
                        <span className={styles.posValue}>{p.peak != null ? `$${p.peak.toFixed(2)}` : "—"}</span>
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
                          ) : (
                            "—"
                          )}
                        </span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>Trail</span>
                        <span className={styles.posValue}>{p.trail_pct != null ? `${p.trail_pct}%` : "—"}</span>
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
            <InfoTip text="Stop-triggered exits from your bots, plus recent Alpaca sell fills not already covered by a stop event." />
          </h2>
          {closedPos.length === 0 ? (
            <Card>
              <p className={styles.emptyText}>No closed positions</p>
            </Card>
          ) : (
            <div className={styles.posGrid}>
              {closedPos.map((p) => {
                const gain = p.current_gain_pct ?? 0;
                const tint = gain >= 0 ? "success" : "danger";
                return (
                  <Card key={`${p.ticker}-${p.exit_timestamp ?? "x"}`} tint={tint} className={styles.posCard}>
                    <div className={styles.posHeader}>
                      <span className={styles.ticker}>{p.ticker}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {p.source === "alpaca" ? (
                          <>
                            <span className={styles.badge}>Alpaca</span>
                            <StatusChip status="submitted" />
                          </>
                        ) : (
                          <StatusChip status="stop_triggered" />
                        )}
                      </div>
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
                        <span className={styles.posValue}>{p.peak != null ? `$${p.peak.toFixed(2)}` : "—"}</span>
                      </div>
                      <div className={styles.posMetric}>
                        <span className={styles.posLabel}>P&L</span>
                        <span className={`${styles.posValue} ${gain >= 0 ? styles.gainUp : styles.gainDown}`}>
                          {p.current_gain_pct != null ? (
                            <>
                              {gain >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                              {gain.toFixed(1)}%
                            </>
                          ) : (
                            "—"
                          )}
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
