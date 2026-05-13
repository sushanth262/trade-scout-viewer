"use client";
import { useEffect, useState, useCallback } from "react";
import MetricCard from "@/components/ui/MetricCard";
import Card from "@/components/ui/Card";
import StatusChip from "@/components/ui/StatusChip";
import InfoTip from "@/components/ui/InfoTip";
import { fetchApi, StatsResponse, PaginatedResponse } from "@/lib/api";
import { TradeEvent } from "@/lib/cosmos";
import { ArrowRightLeft, Radar, TrendingUp, AlertTriangle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./page.module.css";

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [s, t] = await Promise.all([
        fetchApi<StatsResponse>("/api/stats"),
        fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", { limit: "8" }),
      ]);
      setStats(s);
      setRecentTrades(t.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitted = stats?.statusBreakdown.find((s) => s.status === "submitted")?.count ?? 0;
  const stopped = stats?.statusBreakdown.find((s) => s.status === "stop_triggered")?.count ?? 0;
  const failed = stats?.statusBreakdown.find((s) => s.status === "failed")?.count ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.subtitle}>
          {loading ? "Loading..." : error ? error : `Last refreshed: ${new Date().toLocaleTimeString()}`}
        </p>
      </div>

      <div className={styles.metrics}>
        <MetricCard
          label="Total Trades"
          value={stats?.totalTrades ?? "—"}
          delta={`${stats?.todayTrades ?? 0} today`}
          deltaType="neutral"
          icon={<ArrowRightLeft size={18} />}
          help="Every trade event the bots have recorded — buys, watches, sells, skips, and failures. 'Today' counts only those with today's UTC date."
        />
        <MetricCard
          label="Submitted"
          value={submitted}
          tint="success"
          icon={<TrendingUp size={18} />}
          help="Buy orders the bot actually sent to Alpaca successfully (not necessarily filled yet). A submitted order may still be working or partially filled."
        />
        <MetricCard
          label="Signals Screened"
          value={stats?.totalSignals ?? "—"}
          delta={`${stats?.buySignals ?? 0} BUY-rated`}
          deltaType="up"
          tint="info"
          icon={<Radar size={18} />}
          help="Picks the bots evaluated this period. Earnings-trade screens tickers with upcoming earnings + politician buying; copytrade evaluates every disclosure it sees. BUY-rated = strong conviction (the bot would or did trade it)."
        />
        <MetricCard
          label="Stops Triggered"
          value={stopped}
          tint={stopped > 0 ? "warning" : "none"}
          icon={<AlertTriangle size={18} />}
          help="Positions that were sold because the trailing stop fired — price dropped past the protective level. This is normal risk-management activity, not an error."
        />
        <MetricCard
          label="Failed"
          value={failed}
          tint={failed > 0 ? "danger" : "none"}
          icon={<AlertTriangle size={18} />}
          help="Orders Alpaca rejected (e.g., asset inactive, insufficient buying power, market closed). Check the Bot Logs tab for the rejection reason."
        />
      </div>

      <div className={styles.grid}>
        <Card className={styles.breakdownCard}>
          <h2 className={styles.sectionTitle}>
            Status Breakdown
            <InfoTip text="How every recorded trade event resolved. 'submitted' = order sent to Alpaca; 'watch_logged' = the bot saw the trade but conviction was too low to act; 'skipped_daily_limit' = hit the per-day buy cap; 'sell_logged' = a politician sold (we don't mirror sells, the trailing stop handles exits); 'failed' = Alpaca rejected the order." />
          </h2>
          {stats?.statusBreakdown.length === 0 && (
            <p className={styles.emptyText}>No trades recorded yet</p>
          )}
          <div className={styles.breakdownList}>
            {stats?.statusBreakdown.map((s) => (
              <div key={s.status} className={styles.breakdownRow}>
                <StatusChip status={s.status} />
                <span className={styles.breakdownCount}>{s.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className={styles.recentCard}>
          <h2 className={styles.sectionTitle}>
            Recent Activity
            <InfoTip text="The 8 most recent trade events from either bot, newest first. Useful for spotting what just happened — same data is on the Trade Log tab in full." />
          </h2>
          {recentTrades.length === 0 && (
            <p className={styles.emptyText}>No recent trades</p>
          )}
          <div className={styles.activityList}>
            {recentTrades.map((t, i) => (
              <div key={i} className={styles.activityItem}>
                <div className={styles.activityLeft}>
                  <span className={styles.ticker}>{t.ticker ?? t.symbol}</span>
                  <StatusChip status={t.event === "stop_triggered" ? "stop_triggered" : t.status} />
                </div>
                <div className={styles.activityRight}>
                  {t.entry_price && (
                    <span className={styles.price}>${t.entry_price.toFixed(2)}</span>
                  )}
                  {t.notional && (
                    <span className={styles.notional}>${t.notional.toLocaleString()}</span>
                  )}
                  <span className={styles.time}>
                    <Clock size={11} />
                    {t.timestamp ? formatDistanceToNow(new Date(t.timestamp), { addSuffix: true }) : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
