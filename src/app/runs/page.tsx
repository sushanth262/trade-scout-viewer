"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { fetchApi } from "@/lib/api";
import { RefreshCw, Activity, CheckCircle2, XCircle, Clock } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, ReferenceLine,
} from "recharts";
import styles from "./page.module.css";

interface RunRecord {
  job: "copytrade" | "earnings-trade";
  timestamp: string;
  status: "success" | "fail";
  submitted: number;
  watched: number;
  failed: number;
  quiver: number;
  capitolTrades: number;
  confirmed: number;
  screened: number;
  buyRated: number;
  summary: string;
}

interface AggregateBuckets {
  submitted: number;
  watched: number;
  failed: number;
  quiver: number;
  capitolTrades: number;
  confirmed: number;
  screened: number;
  buyRated: number;
}

interface RunsResponse {
  runs: RunRecord[];
  copytrade: AggregateBuckets;
  earningsTrade: AggregateBuckets;
  files: { job: string; path: string | null; sizeBytes: number; mtime: string | null }[];
  generatedAt: string;
}

const WINDOW_OPTIONS = [
  { hours: 24,  label: "24h" },
  { hours: 72,  label: "3d"  },
  { hours: 168, label: "7d"  },
  { hours: 720, label: "30d" },
];

const COPYTRADE_COLOR = "#1B2B65"; // brand-500
const EARNINGS_COLOR  = "#F59E0B"; // warning-500
const SUCCESS_COLOR   = "#22C55E"; // success-500
const FAIL_COLOR      = "#EF4444"; // danger-500

function fmtTimeShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

function fmtTimeWithZone(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "short",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Tooltip for line chart
type LineDatum = { time: number; iso: string; copytrade: number | null; "earnings-trade": number | null; ctRun?: RunRecord; etRun?: RunRecord };

function LineTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: LineDatum }> }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>
        <Clock size={11} /> {fmtTimeWithZone(d.iso)}
      </div>
      {d.ctRun && (
        <div className={styles.tooltipRow}>
          <span className={styles.dot} style={{ background: COPYTRADE_COLOR }} />
          <span className={styles.tooltipJob}>copytrade</span>
          <span className={d.ctRun.status === "success" ? styles.success : styles.fail}>
            {d.ctRun.status === "success" ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {d.ctRun.status}
          </span>
          <span className={styles.tooltipSummary}>{d.ctRun.summary}</span>
        </div>
      )}
      {d.etRun && (
        <div className={styles.tooltipRow}>
          <span className={styles.dot} style={{ background: EARNINGS_COLOR }} />
          <span className={styles.tooltipJob}>earnings-trade</span>
          <span className={d.etRun.status === "success" ? styles.success : styles.fail}>
            {d.etRun.status === "success" ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {d.etRun.status}
          </span>
          <span className={styles.tooltipSummary}>{d.etRun.summary}</span>
        </div>
      )}
    </div>
  );
}

// Custom dot to color by success/fail
function StatusDot(props: { cx?: number; cy?: number; payload?: LineDatum; dataKey?: string }) {
  const { cx, cy, payload, dataKey } = props;
  if (cx == null || cy == null || !payload) return null;
  const run = dataKey === "copytrade" ? payload.ctRun : payload.etRun;
  if (!run) return null;
  const color = run.status === "success" ? SUCCESS_COLOR : FAIL_COLOR;
  const stroke = dataKey === "copytrade" ? COPYTRADE_COLOR : EARNINGS_COLOR;
  return (
    <circle cx={cx} cy={cy} r={4.5} fill={color} stroke={stroke} strokeWidth={1.5} />
  );
}

export default function RunsPage() {
  const [data, setData] = useState<RunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(168);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi<RunsResponse>("/api/runs", { hours: String(hours) });
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Build line-chart series — one point per unique timestamp, copytrade=1 lane, earnings-trade=2 lane
  const lineSeries = useMemo<LineDatum[]>(() => {
    if (!data?.runs) return [];
    const byTime = new Map<string, LineDatum>();
    for (const r of data.runs) {
      const lane = r.job === "copytrade" ? 1 : 2;
      const key = r.timestamp;
      const existing = byTime.get(key);
      if (existing) {
        if (r.job === "copytrade") {
          existing.copytrade = lane;
          existing.ctRun = r;
        } else {
          existing["earnings-trade"] = lane;
          existing.etRun = r;
        }
      } else {
        byTime.set(key, {
          time: Date.parse(r.timestamp),
          iso: r.timestamp,
          copytrade: r.job === "copytrade" ? lane : null,
          "earnings-trade": r.job === "earnings-trade" ? lane : null,
          ctRun: r.job === "copytrade" ? r : undefined,
          etRun: r.job === "earnings-trade" ? r : undefined,
        });
      }
    }
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  }, [data]);

  // Bar chart data: categories × jobs
  const barData = useMemo(() => {
    if (!data) return [];
    const ct = data.copytrade;
    const et = data.earningsTrade;
    return [
      { category: "Submitted",    copytrade: ct.submitted, "earnings-trade": et.submitted },
      { category: "Watched",      copytrade: ct.watched,   "earnings-trade": et.watched   },
      { category: "Failed",       copytrade: ct.failed,    "earnings-trade": et.failed    },
      { category: "Screened",     copytrade: 0,            "earnings-trade": et.screened  },
      { category: "BUY-rated",    copytrade: 0,            "earnings-trade": et.buyRated  },
      { category: "Quiver",       copytrade: ct.quiver,    "earnings-trade": et.quiver    },
      { category: "Capitol Trades", copytrade: ct.capitolTrades, "earnings-trade": et.capitolTrades },
      { category: "Confirmed",    copytrade: ct.confirmed, "earnings-trade": et.confirmed },
    ];
  }, [data]);

  const totals = useMemo(() => {
    const runs = data?.runs ?? [];
    const ct = runs.filter((r) => r.job === "copytrade");
    const et = runs.filter((r) => r.job === "earnings-trade");
    return {
      copytrade: { total: ct.length, success: ct.filter((r) => r.status === "success").length, fail: ct.filter((r) => r.status === "fail").length },
      earningsTrade: { total: et.length, success: et.filter((r) => r.status === "success").length, fail: et.filter((r) => r.status === "fail").length },
    };
  }, [data]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Job Runs</h1>
        <p className={styles.subtitle}>
          Cron-scheduled run history for copytrade and earnings-trade · auto-refresh every 60s. Indicator-alert-bot runs
          on its own schedule — use the <strong>Bot Logs</strong> tab (indicator-alert-bot) for its output.
        </p>
      </div>

      <div className={styles.controls}>
        <div className={styles.tabGroup}>
          {WINDOW_OPTIONS.map((o) => (
            <button
              key={o.hours}
              className={`${styles.tab} ${hours === o.hours ? styles.tabActive : ""}`}
              onClick={() => setHours(o.hours)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button className={styles.refreshBtn} onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? styles.spin : ""} /> Refresh
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summaryRow}>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <span className={styles.dot} style={{ background: COPYTRADE_COLOR }} />
            <span className={styles.summaryJob}>copytrade</span>
          </div>
          <div className={styles.summaryStats}>
            <span><Activity size={12} /> {totals.copytrade.total} runs</span>
            <span className={styles.success}><CheckCircle2 size={12} /> {totals.copytrade.success}</span>
            <span className={styles.fail}><XCircle size={12} /> {totals.copytrade.fail}</span>
          </div>
        </Card>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <span className={styles.dot} style={{ background: EARNINGS_COLOR }} />
            <span className={styles.summaryJob}>earnings-trade</span>
          </div>
          <div className={styles.summaryStats}>
            <span><Activity size={12} /> {totals.earningsTrade.total} runs</span>
            <span className={styles.success}><CheckCircle2 size={12} /> {totals.earningsTrade.success}</span>
            <span className={styles.fail}><XCircle size={12} /> {totals.earningsTrade.fail}</span>
          </div>
        </Card>
      </div>

      <Card className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <h2 className={styles.sectionTitle}>
            Run Timeline
            <InfoTip text="Each dot is one cron-scheduled run of a bot. Green = the run finished cleanly (the bot logged 'Cycle done'); red = the bot exited without finishing. Copytrade runs on the lower track, earnings-trade on the upper track. Failures usually mean a network issue or an unhandled exception — check Bot Logs for the trace." />
          </h2>
          <span className={styles.legendHint}>
            <span className={styles.dot} style={{ background: SUCCESS_COLOR }} /> success
            <span className={styles.dot} style={{ background: FAIL_COLOR, marginLeft: 12 }} /> fail
          </span>
        </div>
        <div className={styles.chartBox}>
          {lineSeries.length === 0 ? (
            <div className={styles.emptyChart}>
              {loading ? "Loading runs…" : "No runs in the selected window"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineSeries} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  tickFormatter={(v) => fmtTimeShort(new Date(v).toISOString())}
                  tick={{ fontSize: 11, fill: "#6B7A99" }}
                  stroke="#CBD5E1"
                  minTickGap={40}
                />
                <YAxis
                  type="number"
                  domain={[0, 3]}
                  ticks={[1, 2]}
                  tickFormatter={(v) => (v === 1 ? "copytrade" : v === 2 ? "earnings-trade" : "")}
                  tick={{ fontSize: 11, fill: "#6B7A99" }}
                  stroke="#CBD5E1"
                  width={110}
                />
                <ReferenceLine y={1} stroke="#E2E8F0" />
                <ReferenceLine y={2} stroke="#E2E8F0" />
                <Tooltip content={<LineTooltip />} />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />
                <Line
                  type="stepAfter"
                  dataKey="copytrade"
                  stroke={COPYTRADE_COLOR}
                  strokeWidth={1.5}
                  connectNulls
                  dot={<StatusDot />}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="earnings-trade"
                  stroke={EARNINGS_COLOR}
                  strokeWidth={1.5}
                  connectNulls
                  dot={<StatusDot />}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <h2 className={styles.sectionTitle}>
            Trade Outcomes & Source Pulls
            <InfoTip text="Aggregate counts across all runs in the selected window. Submitted = orders sent to Alpaca. Watched = picks the bot saw but didn't trade (low conviction). Failed = Alpaca rejected the order. Screened/BUY-rated apply to earnings-trade only. Quiver / Capitol Trades = how many tickers were pulled from each source feed. Confirmed = tickers that appeared in BOTH sources (highest conviction)." />
          </h2>
          <span className={styles.legendHint}>
            Aggregated over the selected window
          </span>
        </div>
        <div className={styles.chartBox}>
          {barData.every((b) => b.copytrade === 0 && b["earnings-trade"] === 0) ? (
            <div className={styles.emptyChart}>
              {loading ? "Loading…" : "No data to aggregate yet"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={barData} margin={{ top: 12, right: 24, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 11, fill: "#6B7A99" }}
                  stroke="#CBD5E1"
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#6B7A99" }}
                  stroke="#CBD5E1"
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  cursor={{ fill: "rgba(27,43,101,0.05)" }}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />
                <Bar dataKey="copytrade"      fill={COPYTRADE_COLOR} radius={[4, 4, 0, 0]} />
                <Bar dataKey="earnings-trade" fill={EARNINGS_COLOR}  radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className={styles.fileMeta}>
        {data?.files.map((f) => (
          <span key={f.job}>
            <strong>{f.job}:</strong>{" "}
            {f.path ? (
              <>
                {f.path} · {formatSize(f.sizeBytes)} · last write {f.mtime ? new Date(f.mtime).toLocaleString() : "—"}
              </>
            ) : (
              "log file not found"
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
