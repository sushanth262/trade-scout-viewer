"use client";
import { useEffect, useState, useCallback } from "react";
import FilterBar from "@/components/ui/FilterBar";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusChip from "@/components/ui/StatusChip";
import { fetchApi, PaginatedResponse } from "@/lib/api";
import { TradeEvent } from "@/lib/cosmos";
import { format } from "date-fns";
import styles from "./page.module.css";

const STATUS_OPTIONS = [
  "submitted", "dry_run", "skipped_not_rated", "skipped_blocked",
  "skipped_duplicate", "skipped_insufficient_cash", "failed",
];

const SOURCE_OPTIONS = ["earnings", "copytrade"];

const filters = [
  { key: "status", label: "Status", options: STATUS_OPTIONS },
  { key: "source", label: "Source", options: SOURCE_OPTIONS },
];

const columns: Column<TradeEvent>[] = [
  {
    key: "timestamp",
    header: "Time",
    width: "160px",
    render: (r) => r.timestamp ? format(new Date(r.timestamp), "MMM dd, HH:mm:ss") : "—",
  },
  {
    key: "ticker",
    header: "Ticker",
    width: "80px",
    render: (r) => <span className={styles.ticker}>{r.ticker ?? r.symbol}</span>,
  },
  {
    key: "event",
    header: "Event",
    width: "120px",
    render: (r) => r.event === "stop_triggered" ? "Stop Triggered" : "Trade Execution",
  },
  {
    key: "status",
    header: "Status",
    width: "160px",
    render: (r) => <StatusChip status={r.event === "stop_triggered" ? "stop_triggered" : r.status} />,
  },
  {
    key: "rating",
    header: "Rating",
    width: "80px",
    render: (r) => r.rating ? <StatusChip status={r.rating} /> : "—",
  },
  {
    key: "entry_price",
    header: "Entry",
    width: "90px",
    render: (r) => r.entry_price ? `$${r.entry_price.toFixed(2)}` : "—",
  },
  {
    key: "notional",
    header: "Notional",
    width: "100px",
    render: (r) => r.notional ? `$${r.notional.toLocaleString()}` : "—",
  },
  {
    key: "earnings_date",
    header: "Earnings",
    width: "100px",
    render: (r) => r.earnings_date ?? "—",
  },
];

export default function TradesPage() {
  const [data, setData] = useState<TradeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [searchTicker, setSearchTicker] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        limit: String(limit),
        offset: String(page * limit),
      };
      if (searchTicker) params.ticker = searchTicker.toUpperCase();
      Object.entries(filterValues).forEach(([k, v]) => {
        if (v) params[k] = v;
      });

      const res = await fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", params);
      setData(res.items);
      setTotal(res.total);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filterValues, searchTicker, page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Trade Log</h1>
      <p className={styles.subtitle}>All trade executions and stop events</p>

      <FilterBar
        filters={filters}
        values={filterValues}
        onChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        onSearch={(t) => { setSearchTicker(t); setPage(0); }}
        searchPlaceholder="Filter by ticker..."
      />

      <DataTable columns={columns} data={data} loading={loading} emptyMessage="No trades match your filters" />

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={styles.pageBtn}>
            Previous
          </button>
          <span className={styles.pageInfo}>
            Page {page + 1} of {totalPages} ({total} total)
          </span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className={styles.pageBtn}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
