"use client";
import { useEffect, useState, useCallback } from "react";
import FilterBar from "@/components/ui/FilterBar";
import DataTable, { Column } from "@/components/ui/DataTable";
import StatusChip from "@/components/ui/StatusChip";
import { fetchApi, PaginatedResponse } from "@/lib/api";
import { Signal } from "@/lib/cosmos";
import { format } from "date-fns";
import styles from "./page.module.css";

const filters = [
  { key: "rating", label: "Rating", options: ["BUY", "WATCH"] },
  { key: "conviction", label: "Conviction", options: ["VERY HIGH", "HIGH", "MEDIUM", "LOW"] },
  { key: "confirmed", label: "Confirmed", options: ["true", "false"] },
];

const columns: Column<Signal>[] = [
  {
    key: "screened_at",
    header: "Screened",
    width: "150px",
    render: (r) => r.screened_at ? format(new Date(r.screened_at), "MMM dd, HH:mm") : "—",
  },
  {
    key: "ticker",
    header: "Ticker",
    width: "80px",
    render: (r) => <span className={styles.ticker}>{r.ticker}</span>,
  },
  {
    key: "rating",
    header: "Rating",
    width: "80px",
    render: (r) => <StatusChip status={r.rating} />,
  },
  {
    key: "conviction",
    header: "Conviction",
    width: "110px",
    render: (r) => <StatusChip status={r.conviction} />,
  },
  {
    key: "entry_price",
    header: "Price",
    width: "90px",
    render: (r) => `$${r.entry_price.toFixed(2)}`,
  },
  {
    key: "earnings_date",
    header: "Earnings",
    width: "100px",
    render: (r) => r.earnings_date,
  },
  {
    key: "insider_buying",
    header: "Insider $",
    width: "100px",
    render: (r) => `$${(r.insider_buying / 1000).toFixed(0)}K`,
  },
  {
    key: "insider_sent",
    header: "Insider",
    width: "90px",
    render: (r) => <StatusChip status={r.insider_sent} />,
  },
  {
    key: "options_sent",
    header: "Options",
    width: "90px",
    render: (r) => <StatusChip status={r.options_sent} />,
  },
  {
    key: "confirmed",
    header: "Confirmed",
    width: "90px",
    render: (r) => (
      <span className={r.confirmed ? styles.confirmed : styles.unconfirmed}>
        {r.confirmed ? "Yes" : "No"}
      </span>
    ),
  },
  {
    key: "sector",
    header: "Sector",
    width: "110px",
    render: (r) => r.sector,
  },
  {
    key: "politicians",
    header: "Politicians",
    width: "160px",
    render: (r) => r.politicians?.join(", ") ?? "—",
  },
];

export default function SignalsPage() {
  const [data, setData] = useState<Signal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [searchTicker, setSearchTicker] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit), offset: String(page * limit) };
      if (searchTicker) params.ticker = searchTicker.toUpperCase();
      Object.entries(filterValues).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await fetchApi<PaginatedResponse<Signal>>("/api/signals", params);
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
      <h1 className={styles.title}>Signals</h1>
      <p className={styles.subtitle}>Screened tickers with full analysis data</p>

      <FilterBar
        filters={filters}
        values={filterValues}
        onChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        onSearch={(t) => { setSearchTicker(t); setPage(0); }}
      />

      <DataTable columns={columns} data={data} loading={loading} emptyMessage="No signals match your filters" />

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={styles.pageBtn}>Previous</button>
          <span className={styles.pageInfo}>Page {page + 1} of {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className={styles.pageBtn}>Next</button>
        </div>
      )}
    </div>
  );
}
