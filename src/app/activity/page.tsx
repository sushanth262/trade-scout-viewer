"use client";
import { useEffect, useState, useCallback } from "react";
import Card from "@/components/ui/Card";
import StatusChip from "@/components/ui/StatusChip";
import { fetchApi, PaginatedResponse } from "@/lib/api";
import { TradeEvent } from "@/lib/cosmos";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRightLeft,
  AlertTriangle,
  Ban,
  CheckCircle,
  Clock,
  DollarSign,
  FileWarning,
} from "lucide-react";
import styles from "./page.module.css";

const eventIcon: Record<string, React.ReactNode> = {
  submitted: <CheckCircle size={16} color="var(--success-500)" />,
  dry_run: <DollarSign size={16} color="var(--info-500)" />,
  failed: <AlertTriangle size={16} color="var(--danger-500)" />,
  skipped_not_rated: <Ban size={16} color="#9CA3AF" />,
  skipped_blocked: <Ban size={16} color="var(--warning-500)" />,
  skipped_duplicate: <FileWarning size={16} color="#9CA3AF" />,
  skipped_insufficient_cash: <DollarSign size={16} color="var(--warning-500)" />,
  stop_triggered: <AlertTriangle size={16} color="var(--danger-500)" />,
};

export default function ActivityPage() {
  const [items, setItems] = useState<TradeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<PaginatedResponse<TradeEvent>>("/api/trades", {
        limit: String(limit),
        offset: String(page * limit),
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const grouped = items.reduce((acc, item) => {
    const day = item.timestamp ? format(new Date(item.timestamp), "yyyy-MM-dd") : "unknown";
    if (!acc[day]) acc[day] = [];
    acc[day].push(item);
    return acc;
  }, {} as Record<string, TradeEvent[]>);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Activity Feed</h1>
      <p className={styles.subtitle}>Chronological log of all trade events</p>

      {loading ? (
        <Card><div className={styles.loading}><div className={styles.spinner} />Loading...</div></Card>
      ) : items.length === 0 ? (
        <Card><p className={styles.emptyText}>No activity recorded yet</p></Card>
      ) : (
        <div className={styles.timeline}>
          {Object.entries(grouped).map(([day, events]) => (
            <div key={day} className={styles.dayGroup}>
              <div className={styles.dayLabel}>
                <Clock size={14} />
                {day === "unknown" ? "Unknown Date" : format(new Date(day), "EEEE, MMMM d, yyyy")}
              </div>
              {events.map((e, i) => {
                const eventType = e.event === "stop_triggered" ? "stop_triggered" : e.status;
                return (
                  <div key={i} className={styles.eventRow}>
                    <div className={styles.iconCol}>
                      {eventIcon[eventType] ?? <ArrowRightLeft size={16} color="var(--text-tertiary)" />}
                      {i < events.length - 1 && <div className={styles.connector} />}
                    </div>
                    <Card className={styles.eventCard}>
                      <div className={styles.eventHeader}>
                        <span className={styles.ticker}>{e.ticker ?? e.symbol}</span>
                        <StatusChip status={eventType} />
                        <span className={styles.time}>
                          {e.timestamp ? formatDistanceToNow(new Date(e.timestamp), { addSuffix: true }) : "—"}
                        </span>
                      </div>
                      <div className={styles.eventDetails}>
                        {e.entry_price && <span>Entry: <strong>${e.entry_price.toFixed(2)}</strong></span>}
                        {e.notional && <span>Notional: <strong>${e.notional.toLocaleString()}</strong></span>}
                        {e.price && <span>Exit: <strong>${e.price.toFixed(2)}</strong></span>}
                        {e.peak && <span>Peak: <strong>${e.peak.toFixed(2)}</strong></span>}
                        {e.trail_pct && <span>Trail: <strong>{e.trail_pct}%</strong></span>}
                        {e.rating && <span>Rating: <StatusChip status={e.rating} /></span>}
                        {e.earnings_date && <span>Earnings: {e.earnings_date}</span>}
                        {e.size_label && <span>Size: {e.size_label}</span>}
                        {e.error && <span className={styles.error}>Error: {e.error}</span>}
                        {e.note && <span className={styles.note}>{e.note}</span>}
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {Math.ceil(total / limit) > 1 && (
        <div className={styles.pagination}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={styles.pageBtn}>Previous</button>
          <span className={styles.pageInfo}>Page {page + 1} of {Math.ceil(total / limit)}</span>
          <button disabled={page >= Math.ceil(total / limit) - 1} onClick={() => setPage((p) => p + 1)} className={styles.pageBtn}>Next</button>
        </div>
      )}
    </div>
  );
}
