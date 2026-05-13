"use client";
import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import Card from "@/components/ui/Card";
import { fetchApi } from "@/lib/api";
import { RefreshCw, ScrollText, FileText } from "lucide-react";
import styles from "./page.module.css";

interface LogResponse {
  name: string;
  file: string;
  sizeBytes: number;
  totalLines: number;
  days: number;
  sources?: { local: number; cosmos: number };
  lines: string[];
}

const LOG_TABS = [
  { key: "earnings-trade", label: "Earnings Trade" },
  { key: "copytrade", label: "Copytrade" },
  { key: "cosmos", label: "Cosmos Sync" },
];

const LEVELS = ["", "INFO", "WARNING", "ERROR"];
const DAY_OPTIONS = [1, 3, 7];

function parseLevel(line: string): string {
  if (/\bERROR\b/.test(line)) return "ERROR";
  if (/\bWARNING\b/.test(line)) return "WARNING";
  if (/\bDEBUG\b/.test(line)) return "DEBUG";
  if (/\bINFO\b/.test(line)) return "INFO";
  return "";
}

function highlightSearch(text: string, search: string) {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <Fragment>
      {text.slice(0, idx)}
      <span className={styles.highlight}>{text.slice(idx, idx + search.length)}</span>
      {text.slice(idx + search.length)}
    </Fragment>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LogsPage() {
  const [activeLog, setActiveLog] = useState("earnings-trade");
  const [data, setData] = useState<LogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [days, setDays] = useState(3);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        name: activeLog,
        days: String(days),
        tail: "2000",
      };
      if (level) params.level = level;
      if (search) params.search = search;
      const res = await fetchApi<LogResponse>("/api/logs", params);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeLog, level, search, days]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [data, autoScroll]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Bot Logs</h1>
        <p className={styles.subtitle}>Last {days} day{days === 1 ? "" : "s"} · local file + Cosmos sync</p>
      </div>

      <div className={styles.controls}>
        <div className={styles.tabGroup}>
          {LOG_TABS.map((t) => (
            <button
              key={t.key}
              className={`${styles.tab} ${activeLog === t.key ? styles.tabActive : ""}`}
              onClick={() => { setActiveLog(t.key); setAutoScroll(true); }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.levelGroup}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              className={`${styles.levelBtn} ${days === d ? styles.levelActive : ""}`}
              onClick={() => setDays(d)}
              title={`Show last ${d} day${d === 1 ? "" : "s"}`}
            >
              {d}d
            </button>
          ))}
        </div>

        <input
          className={styles.searchInput}
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />

        <div className={styles.levelGroup}>
          {LEVELS.map((l) => (
            <button
              key={l || "ALL"}
              className={`${styles.levelBtn} ${level === l ? styles.levelActive : ""}`}
              onClick={() => setLevel(l)}
            >
              {l || "ALL"}
            </button>
          ))}
        </div>

        <button className={styles.refreshBtn} onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {data && (
        <div className={styles.meta}>
          <span><FileText size={11} /> {data.file}</span>
          <span>{formatSize(data.sizeBytes)}</span>
          <span>{data.totalLines} lines in window</span>
          {data.sources && (
            <span>
              local {data.sources.local} · cosmos {data.sources.cosmos}
            </span>
          )}
          <span>Showing {data.lines.length}</span>
          <label style={{ marginLeft: "auto", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              style={{ marginRight: 4 }}
            />
            Auto-scroll
          </label>
        </div>
      )}

      <div className={styles.logContainer}>
        {loading ? (
          <div className={styles.loading}><div className={styles.spinner} />Loading logs...</div>
        ) : !data || data.lines.length === 0 ? (
          <div className={styles.emptyState}>
            <ScrollText size={40} className={styles.emptyIcon} />
            <span>No log entries found</span>
            <span style={{ fontSize: 11 }}>Bot logs will appear here once the scheduled tasks run</span>
          </div>
        ) : (
          <div className={styles.logContent}>
            {data.lines.map((line, i) => {
              const lvl = parseLevel(line);
              const cls = lvl ? styles[`level${lvl}` as keyof typeof styles] : styles.levelDefault;
              return (
                <span key={i} className={`${styles.logLine} ${cls}`}>
                  {highlightSearch(line, search)}{"\n"}
                </span>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
