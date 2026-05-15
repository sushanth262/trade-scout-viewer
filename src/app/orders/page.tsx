"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { RefreshCw, ClipboardList } from "lucide-react";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import BotChip from "@/components/ui/BotChip";
import type { FlatOrder } from "@/app/api/orders/route";
import styles from "./page.module.css";

const BOTS_ALL = ["all", "copytrade", "earnings-trade", "indicator-alert-bot", "unknown"] as const;

export default function OrdersPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [orders, setOrders] = useState<FlatOrder[]>([]);
  const [ordersConfigured, setOrdersConfigured] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [orderErr, setOrderErr] = useState<string | null>(null);

  const [botFilter, setBotFilter] = useState<(typeof BOTS_ALL)[number]>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    setOrderErr(null);
    try {
      const r = await fetch(`${basePath}/api/orders`, { cache: "no-store" });
      const j = (await r.json()) as {
        configured?: boolean;
        hint?: string;
        orders?: FlatOrder[];
        error?: string;
      };
      if (!r.ok) {
        setOrderErr(j.error ?? r.statusText);
        setOrders([]);
        return;
      }
      setOrdersConfigured(j.configured !== false);
      setHint(j.hint ?? null);
      setOrders(j.orders ?? []);
    } catch (e) {
      setOrderErr(e instanceof Error ? e.message : "Failed to load orders");
      setOrders([]);
    }
  }, [basePath]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      await loadOrders();
      if (!cancelled) setLoading(false);
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [loadOrders]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      set.add(o.order_type_label || o.type);
    }
    return ["all", ...[...set].sort()];
  }, [orders]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) set.add(o.status);
    return ["all", ...[...set].sort()];
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (botFilter !== "all" && o.bot !== botFilter) return false;
      if (typeFilter !== "all") {
        const lbl = o.order_type_label || o.type;
        if (lbl !== typeFilter) return false;
      }
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      return true;
    });
  }, [orders, botFilter, typeFilter, statusFilter]);

  const refresh = async () => {
    setLoading(true);
    await loadOrders();
    setLoading(false);
  };

  function formatTs(iso: string | null | undefined): string {
    if (!iso) return "—";
    try {
      return formatDistanceToNow(parseISO(iso), { addSuffix: true });
    } catch {
      return iso.slice(0, 16);
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>
        <ClipboardList size={24} style={{ verticalAlign: "middle", marginRight: 8 }} />
        Orders
      </h1>
      <p className={styles.subtitle}>
        Alpaca orders (last ~500); bot is inferred from Cosmos trade submissions and indicator alert executions.{" "}
        <strong>Historical rows</strong> may show as <em>unknown</em> until linked from your trade log.{" "}
        <Link href="/bot-trades-analysis">Open holdings by bot →</Link>
      </p>

      <Card>
        <div className={styles.toolbar}>
          <span className={styles.count}>
            {filtered.length} order{filtered.length === 1 ? "" : "s"} shown ·{" "}
            {!ordersConfigured && hint ? hint : `${orders.length} loaded from Alpaca`}
            <InfoTip text="Filtering is client-side. Order type joins Alpaca `type` and `order_class` (e.g. market · oto for trailing-stop bundles)." />
          </span>
          <button type="button" className={styles.refreshBtn} onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : undefined} />
            Refresh
          </button>
        </div>

        <div className={styles.filters}>
          <label>
            Bot
            <select value={botFilter} onChange={(e) => setBotFilter(e.target.value as (typeof BOTS_ALL)[number])}>
              {BOTS_ALL.map((b) => (
                <option key={b} value={b}>
                  {b === "all" ? "All bots" : b}
                </option>
              ))}
            </select>
          </label>
          <label>
            Order type
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All types" : t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All statuses" : s}
                </option>
              ))}
            </select>
          </label>
        </div>

        {orderErr && <p className={styles.err}>{orderErr}</p>}

        {loading && orders.length === 0 ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            Loading orders…
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th>Bot</th>
                  <th>Status</th>
                  <th>Qty / Notional</th>
                  <th>Avg fill</th>
                  <th>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id}>
                    <td>{formatTs(o.submitted_at)}</td>
                    <td>
                      <Link href={`/chart/${encodeURIComponent(o.symbol)}`}>{o.symbol}</Link>
                    </td>
                    <td>{o.side}</td>
                    <td>{o.order_type_label || o.type}</td>
                    <td>
                      {o.bot === "unknown" ? (
                        <span className={styles.badgeBot} style={{ background: "#f1f5f9", color: "#64748b" }}>
                          unknown
                        </span>
                      ) : (
                        <BotChip bot={o.bot} />
                      )}
                    </td>
                    <td>{o.status}</td>
                    <td className={styles.mono}>
                      {o.notional ? `$${parseFloat(o.notional).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : o.qty ?? "—"}
                      {o.filled_qty && o.qty ? ` (${o.filled_qty} filled)` : null}
                    </td>
                    <td className={styles.mono}>{o.filled_avg_price ?? "—"}</td>
                    <td className={styles.mono}>{o.id.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && orders.length === 0 && ordersConfigured ? (
              <p className={styles.emptyHint} style={{ padding: 16 }}>
                No orders returned from Alpaca.
              </p>
            ) : null}
            {!filtered.length && orders.length > 0 ? (
              <p className={styles.emptyHint} style={{ padding: 16 }}>
                No rows match filters.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
