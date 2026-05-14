"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import MetricCard from "@/components/ui/MetricCard";
import InfoTip from "@/components/ui/InfoTip";
import { Wallet, RefreshCw, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./page.module.css";

type AccountRes = {
  configured?: boolean;
  hint?: string;
  equity?: string;
  cash?: string;
  portfolio_value?: string;
  buying_power?: string;
  daytrading_buying_power?: string;
  last_equity?: string;
  currency?: string;
  pattern_day_trader?: boolean;
  status?: string;
  error?: string;
};

type Point = { t: string; equity: number; pl: number; pl_pct: number };

function money(v: string | number | undefined, cur = "USD"): string {
  if (v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
}

export default function BalancesPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [account, setAccount] = useState<AccountRes | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [period, setPeriod] = useState("3M");
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, hRes] = await Promise.all([
        fetch(`${basePath}/api/alpaca/account`),
        fetch(`${basePath}/api/alpaca/portfolio-history?period=${encodeURIComponent(period)}&timeframe=1D`),
      ]);
      const a = (await aRes.json()) as AccountRes;
      const h = (await hRes.json()) as { configured?: boolean; points?: Point[]; hint?: string };
      setAccount(a);
      setPoints(h.points ?? []);
      setLastRefreshed(new Date());
    } catch {
      setAccount({ error: "Failed to load" });
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [basePath, period]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const cur = account?.currency ?? "USD";
  const chartData = points.map((p) => ({
    ...p,
    label: p.t.slice(0, 10),
  }));

  const eq = parseFloat(account?.equity ?? "");
  const lastEq = parseFloat(account?.last_equity ?? "");
  const delta =
    Number.isFinite(eq) && Number.isFinite(lastEq) && lastEq !== 0
      ? (((eq - lastEq) / lastEq) * 100).toFixed(2) + "% vs last close"
      : undefined;
  const deltaType = Number.isFinite(eq) && Number.isFinite(lastEq) && eq >= lastEq ? "up" : "down";

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Balances</h1>
      <p className={styles.subtitle}>
        Alpaca paper/live account and equity curve
        {lastRefreshed && ` · refreshed ${formatDistanceToNow(lastRefreshed, { addSuffix: true })}`}
        <button
          type="button"
          className={styles.refresh}
          onClick={() => load()}
          disabled={loading}
          aria-label="Refresh"
        >
          <RefreshCw size={14} className={loading ? styles.spin : ""} />
        </button>
      </p>

      {account?.hint && <p className={styles.notice}>{account.hint}</p>}
      {account?.error && <p className={styles.err}>{account.error}</p>}

      {account?.configured === true && !account?.error && (
        <>
          <div className={styles.metrics}>
            <MetricCard
              label="Equity"
              value={money(account?.equity, cur)}
              delta={delta}
              deltaType={deltaType === "up" ? "up" : "down"}
              tint="info"
              icon={<Wallet size={18} />}
              help="Total account value including positions."
            />
            <MetricCard
              label="Cash"
              value={money(account?.cash, cur)}
              tint="none"
              help="Settled + unsettled cash."
            />
            <MetricCard
              label="Portfolio value"
              value={money(account?.portfolio_value, cur)}
              tint="none"
            />
            <MetricCard
              label="Buying power"
              value={money(account?.buying_power, cur)}
              tint="none"
              help="Funds available to open new positions."
            />
            <MetricCard
              label="Day-trade buying power"
              value={money(account?.daytrading_buying_power, cur)}
              tint="none"
            />
          </div>

          <div className={styles.periodRow}>
            <span className={styles.periodLabel}>Chart range</span>
            <select
              className={styles.select}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Portfolio history range"
            >
              <option value="1W">1 week</option>
              <option value="1M">1 month</option>
              <option value="3M">3 months</option>
              <option value="1A">1 year</option>
              <option value="all">All</option>
            </select>
            <InfoTip text="Daily equity from Alpaca portfolio history. Long ranges require timeframe=1D." />
          </div>

          <Card className={styles.chartCard}>
            <h2 className={styles.chartTitle}>
              <TrendingUp size={18} /> Portfolio equity
            </h2>
            {chartData.length === 0 ? (
              <p className={styles.empty}>No history yet (new account) or still loading.</p>
            ) : (
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand-400)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--brand-400)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--text-tertiary)" />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 11 }}
                      stroke="var(--text-tertiary)"
                      tickFormatter={(v) =>
                        new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)
                      }
                    />
                    <Tooltip
                      formatter={(value) => {
                        const n =
                          value == null || value === ""
                            ? NaN
                            : typeof value === "number"
                              ? value
                              : Number(value);
                        return [money(Number.isFinite(n) ? n : 0, cur), "Equity"];
                      }}
                      labelFormatter={(l) => `Date ${l}`}
                    />
                    <Area type="monotone" dataKey="equity" stroke="var(--brand-500)" fill="url(#eqFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <p className={styles.meta}>
            Status: <code>{account?.status ?? "—"}</code>
            {account?.pattern_day_trader != null && (
              <> · PDT: {account.pattern_day_trader ? "yes" : "no"}</>
            )}
          </p>
        </>
      )}
    </div>
  );
}
