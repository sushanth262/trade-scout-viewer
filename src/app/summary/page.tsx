"use client";
import { useState, useMemo, useCallback } from "react";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import {
  Sparkles, Sparkle, RefreshCw, FileText, Filter,
  AlertTriangle, BarChart3, ListChecks,
} from "lucide-react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { formatLocalTime, formatLocalTimeLong } from "@/lib/time";
import styles from "./page.module.css";

type Provider = "openai" | "gemini";
type BotScope = "copytrade" | "earnings-trade" | "indicator-alert-bot" | "combined";

interface Holding {
  ticker: string;
  company_name?: string;
  purchase_date?: string;
  average_cost_basis?: number;
  quantity?: number;
  current_price?: number;
  recommendation?: {
    action?: string;
    target_price?: number;
    stop_loss?: number;
    thesis_status?: string;
  };
}

interface SummaryResult {
  portfolio_summary?: {
    report_date?: string;
    holdings?: Holding[];
  };
  market_context?: {
    futures_outlook?: { sentiment_score?: string; drivers?: string[] };
    political_pulse?: { congressional_focus?: string; policy_impact?: string };
    top_news_brief?: string[];
  };
  today_summary?: {
    narrative?: string;
    data_pulled_and_filtered?: {
      sources?: { name: string; raw_count: number; after_filter_count: number }[];
      filter_notes?: string;
    };
    failures?: { ticker?: string; reason?: string }[];
  };
  _raw?: string;
}

interface TimelineRow {
  ticker: string;
  bot: string;
  status?: string;
  rating?: string;
  politician?: string;
  timestamp: string;
}

interface CacheInfo {
  hit: boolean;
  cached_at: string;
  age_ms: number;
  ttl_ms: number;
  expires_at: string;
  market_open: boolean;
}

interface SummaryResponse {
  provider: Provider;
  bot: BotScope;
  model: string;
  empty?: boolean;
  counts?: { trades_today: number; signals_today: number; open_positions: number; failures: number };
  timeline?: TimelineRow[];
  result: SummaryResult;
  cache?: CacheInfo;
}

const COPYTRADE_COLOR = "#1B2B65";
const EARNINGS_COLOR = "#F59E0B";
const INDICATOR_COLOR = "#7C3AED";

const STATUS_COLORS: Record<string, string> = {
  submitted:          "#15803D",
  watch_logged:       "#3B82F6",
  failed:             "#B91C1C",
  skipped_duplicate:  "#9CA3AF",
  skipped_daily_limit: "#9CA3AF",
  skipped_blocked:    "#9CA3AF",
  sell_logged:        "#B45309",
  stop_triggered:     "#B45309",
  dry_run:            "#A78BFA",
};

function actionClass(action?: string): string {
  switch ((action || "").toLowerCase()) {
    case "buy":    return styles.actionBuy;
    case "reduce": return styles.actionReduce;
    case "sell":   return styles.actionSell;
    default:       return styles.actionHold;
  }
}

function thesisClass(t?: string): string {
  switch ((t || "").toLowerCase()) {
    case "intact":     return styles.thesisIntact;
    case "weakening":  return styles.thesisWeakening;
    case "broken":     return styles.thesisBroken;
    default:           return "";
  }
}

export default function SummaryPage() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [bot, setBot] = useState<BotScope>("combined");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (opts?: { force?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      const res = await fetch(`${basePath}/api/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, bot, force: opts?.force === true }),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const json: SummaryResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }, [provider, bot]);

  function fmtDuration(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    const mins = Math.round(ms / 60_000);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
  }

  const timelineSeries = useMemo(() => {
    if (!data?.timeline) return { copytrade: [], earnings: [], indicator: [] };
    const series: {
      copytrade: { x: number; y: number; row: TimelineRow }[];
      earnings: { x: number; y: number; row: TimelineRow }[];
      indicator: { x: number; y: number; row: TimelineRow }[];
    } = {
      copytrade: [],
      earnings: [],
      indicator: [],
    };
    for (const r of data.timeline) {
      if (!r.timestamp) continue;
      const x = Date.parse(r.timestamp);
      if (Number.isNaN(x)) continue;
      const b = r.bot ?? "";
      if (b === "copytrade") {
        series.copytrade.push({ x, y: 1, row: r });
      } else if (b === "indicator-alert-bot") {
        series.indicator.push({ x, y: 3, row: r });
      } else {
        series.earnings.push({ x, y: 2, row: r });
      }
    }
    return series;
  }, [data]);

  const holdings = data?.result?.portfolio_summary?.holdings ?? [];
  const sources = data?.result?.today_summary?.data_pulled_and_filtered?.sources ?? [];
  const failures = data?.result?.today_summary?.failures ?? [];
  const market = data?.result?.market_context;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          <Sparkles size={20} style={{ verticalAlign: -2, marginRight: 6 }} />
          Transactions Summary
        </h1>
        <p className={styles.subtitle}>
          AI-generated daily debrief grounded in what <strong>Copy Trade</strong>, <strong>Earnings Trade</strong>, and{" "}
          <strong>Indicator Alert</strong> (when scoped) did today — trades, signals, and open positions from Cosmos.
        </p>
      </div>

      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>
            AI Provider
            <InfoTip text="OpenAI uses gpt-4o-mini, Gemini uses gemini-2.5-flash. Either provider produces the same JSON shape — pick whichever you trust more or whose key has more quota left." />
          </span>
          <div className={styles.tabGroup}>
            <button
              className={`${styles.tab} ${provider === "openai" ? styles.tabActive : ""}`}
              onClick={() => setProvider("openai")}
              disabled={loading}
            >
              <Sparkle size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> ChatGPT
            </button>
            <button
              className={`${styles.tab} ${provider === "gemini" ? styles.tabActive : ""}`}
              onClick={() => setProvider("gemini")}
              disabled={loading}
            >
              <Sparkle size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> Gemini
            </button>
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>
            Bot scope
            <InfoTip text="Combined includes every bot with activity today. A single-bot tab narrows trades, signals, and positions to that strategy only." />
          </span>
          <div className={styles.tabGroup}>
            <button
              className={`${styles.tab} ${bot === "combined" ? styles.tabActive : ""}`}
              onClick={() => setBot("combined")}
              disabled={loading}
            >
              Combined
            </button>
            <button
              className={`${styles.tab} ${bot === "copytrade" ? styles.tabActive : ""}`}
              onClick={() => setBot("copytrade")}
              disabled={loading}
            >
              Copy Trade
            </button>
            <button
              className={`${styles.tab} ${bot === "earnings-trade" ? styles.tabActive : ""}`}
              onClick={() => setBot("earnings-trade")}
              disabled={loading}
            >
              Earnings Trade
            </button>
            <button
              className={`${styles.tab} ${bot === "indicator-alert-bot" ? styles.tabActive : ""}`}
              onClick={() => setBot("indicator-alert-bot")}
              disabled={loading}
            >
              Indicator Alert
            </button>
          </div>
        </div>

        <button className={styles.generateBtn} onClick={() => generate()} disabled={loading}>
          <RefreshCw size={14} className={loading ? styles.spin : ""} />
          {loading ? "Generating..." : "Generate Summary"}
        </button>
      </div>

      {error && <div className={styles.error}>Error: {error}</div>}

      {data && (
        <div className={styles.metaRow}>
          <span className={styles.metaPill}>
            <Sparkle size={11} /> {data.provider} · {data.model}
          </span>
          {data.cache && (
            <span
              className={styles.metaPill}
              style={{
                background: data.cache.hit ? "#FFFBEB" : "#F0FDF4",
                color: data.cache.hit ? "var(--warning-700)" : "var(--success-700)",
              }}
              title={`Cached at ${data.cache.cached_at}. TTL ${fmtDuration(data.cache.ttl_ms)} (${data.cache.market_open ? "trading hours" : "off hours"}). Expires ${data.cache.expires_at}.`}
            >
              {data.cache.hit
                ? `Cached · ${fmtDuration(data.cache.age_ms)} old · expires in ${fmtDuration(Math.max(0, data.cache.ttl_ms - data.cache.age_ms))}`
                : `Fresh · cached for ${fmtDuration(data.cache.ttl_ms)} (${data.cache.market_open ? "trading hours" : "off hours"})`}
            </span>
          )}
          {data.cache?.hit && (
            <button
              type="button"
              onClick={() => generate({ force: true })}
              disabled={loading}
              style={{
                background: "transparent",
                border: "1px solid var(--border-medium)",
                borderRadius: 6,
                padding: "3px 10px",
                fontSize: 11,
                cursor: "pointer",
                color: "var(--text-secondary)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title="Bypass the cache and call the AI again now"
            >
              <RefreshCw size={11} className={loading ? styles.spin : ""} /> Force refresh
            </button>
          )}
          {data.counts && (
            <>
              <span><strong>{data.counts.trades_today}</strong> trade events today</span>
              <span><strong>{data.counts.signals_today}</strong> signals screened</span>
              <span><strong>{data.counts.open_positions}</strong> open positions</span>
              {data.counts.failures > 0 && <span><strong>{data.counts.failures}</strong> failures</span>}
            </>
          )}
        </div>
      )}

      {data?.empty ? (
        <Card><p className={styles.empty}>No trading activity recorded today yet for this scope. Run a bot cycle and try again.</p></Card>
      ) : data ? (
        <>
          <div className={styles.cardGrid}>
            <Card className={styles.card}>
              <div className={styles.cardTitle}>
                <FileText size={16} /> What happened today
                <InfoTip text="3-5 sentence narrative the model wrote based on today's trade events, signal counts and failure modes." />
              </div>
              <div className={styles.narrative}>
                {data.result?.today_summary?.narrative ?? "(no narrative)"}
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardTitle}>
                <Filter size={16} /> Data pulled &amp; filtered
                <InfoTip text="Where the bot pulled candidate tickers from and how many survived each filter step." />
              </div>
              <div className={styles.dataList}>
                {sources.length === 0 ? (
                  <p className={styles.empty}>No sources reported.</p>
                ) : sources.map((s, i) => (
                  <div key={i} className={styles.dataRow}>
                    <span className={styles.dataLabel}>{s.name}</span>
                    <span className={styles.dataValue}>
                      {s.after_filter_count} kept · {s.raw_count} raw
                    </span>
                  </div>
                ))}
              </div>
              {data.result?.today_summary?.data_pulled_and_filtered?.filter_notes && (
                <div className={styles.filterNotes}>
                  {data.result.today_summary.data_pulled_and_filtered.filter_notes}
                </div>
              )}
            </Card>
          </div>

          <Card className={styles.card}>
            <div className={styles.cardTitle}>
              <ListChecks size={16} /> Recommendations
              <InfoTip text="One row per open position. The model's action / target / stop_loss / thesis is grounded only in today's price/peak/stop data — no external news (web grounding disabled per setup)." />
            </div>
            {holdings.length === 0 ? (
              <p className={styles.empty}>No open positions to recommend on.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Company</th>
                      <th>Bought</th>
                      <th>Cost</th>
                      <th>Qty</th>
                      <th>Current</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Stop</th>
                      <th>Thesis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h, i) => (
                      <tr key={i}>
                        <td><strong>{h.ticker}</strong></td>
                        <td>{h.company_name ?? "—"}</td>
                        <td>{h.purchase_date ?? "—"}</td>
                        <td>{h.average_cost_basis != null ? `$${h.average_cost_basis.toFixed(2)}` : "—"}</td>
                        <td>{h.quantity ?? "—"}</td>
                        <td>{h.current_price != null ? `$${h.current_price.toFixed(2)}` : "—"}</td>
                        <td><span className={`${styles.action} ${actionClass(h.recommendation?.action)}`}>{h.recommendation?.action ?? "Hold"}</span></td>
                        <td>{h.recommendation?.target_price != null ? `$${h.recommendation.target_price.toFixed(2)}` : "—"}</td>
                        <td>{h.recommendation?.stop_loss != null ? `$${h.recommendation.stop_loss.toFixed(2)}` : "—"}</td>
                        <td><span className={thesisClass(h.recommendation?.thesis_status)}>{h.recommendation?.thesis_status ?? "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {market && (market.futures_outlook?.sentiment_score || market.political_pulse?.congressional_focus || (market.top_news_brief?.length ?? 0) > 0) && (
            <Card className={styles.card}>
              <div className={styles.cardTitle}>
                <BarChart3 size={16} /> Market context
                <InfoTip text="Higher-level read. Web grounding is OFF, so this is largely inferred from the politicians and sectors in today's signals." />
              </div>
              <div className={styles.dataList}>
                {market.futures_outlook?.sentiment_score && (
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Futures sentiment</span>
                    <span className={styles.dataValue}>{market.futures_outlook.sentiment_score}</span>
                  </div>
                )}
                {(market.futures_outlook?.drivers?.length ?? 0) > 0 && (
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Drivers</span>
                    <span className={styles.dataValue} style={{ textAlign: "right", maxWidth: "70%" }}>
                      {market.futures_outlook!.drivers!.join(" · ")}
                    </span>
                  </div>
                )}
                {market.political_pulse?.congressional_focus && (
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Congressional focus</span>
                    <span className={styles.dataValue} style={{ textAlign: "right", maxWidth: "70%" }}>
                      {market.political_pulse.congressional_focus}
                    </span>
                  </div>
                )}
                {market.political_pulse?.policy_impact && (
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Policy impact</span>
                    <span className={styles.dataValue} style={{ textAlign: "right", maxWidth: "70%" }}>
                      {market.political_pulse.policy_impact}
                    </span>
                  </div>
                )}
                {(market.top_news_brief?.length ?? 0) > 0 && market.top_news_brief!.map((n, i) => (
                  <div key={i} className={styles.dataRow}>
                    <span className={styles.dataLabel}>News {i + 1}</span>
                    <span className={styles.dataValue} style={{ textAlign: "right", maxWidth: "70%" }}>{n}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className={styles.card}>
            <div className={styles.cardTitle}>
              <AlertTriangle size={16} /> Failures
              <InfoTip text="Trades that Alpaca rejected or that errored out. Empty list is good news." />
            </div>
            {failures.length === 0 ? (
              <p className={styles.empty}>No failures recorded for this scope today.</p>
            ) : (
              failures.map((f, i) => (
                <div key={i} className={styles.failureItem}>
                  <span className={styles.failureTicker}>{f.ticker ?? "?"}</span>
                  <span className={styles.failureReason}>{f.reason ?? "(no reason given)"}</span>
                </div>
              ))
            )}
          </Card>

          <Card className={styles.chartCard}>
            <div className={styles.cardTitle}>
              <BarChart3 size={16} /> Timeline · per bot
              <InfoTip text="Each dot is a trade event from today. Color = outcome (green submitted, blue watched, red failed, gray skipped). Swimlanes: Copy Trade (y=1), Earnings Trade (y=2), Indicator Alert (y=3). Legacy rows without bot field use Earnings Trade lane." />
            </div>
            <div className={styles.chartBox}>
              {(timelineSeries.copytrade.length + timelineSeries.earnings.length + timelineSeries.indicator.length) ===
              0 ? (
                <p className={styles.empty}>No transactions recorded today.</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={["dataMin", "dataMax"]}
                      scale="time"
                      tickFormatter={(v) => formatLocalTime(new Date(v).toISOString())}
                      tick={{ fontSize: 11, fill: "#6B7A99" }}
                      stroke="#CBD5E1"
                      minTickGap={40}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={[0, 4]}
                      ticks={[1, 2, 3]}
                      tickFormatter={(v) =>
                        v === 1 ? "Copy Trade" : v === 2 ? "Earnings Trade" : v === 3 ? "Indicator Alert" : ""
                      }
                      tick={{ fontSize: 11, fill: "#6B7A99" }}
                      stroke="#CBD5E1"
                      width={120}
                    />
                    <ReferenceLine y={1} stroke="#E2E8F0" />
                    <ReferenceLine y={2} stroke="#E2E8F0" />
                    <ReferenceLine y={3} stroke="#E2E8F0" />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const datum = payload[0].payload as { row: TimelineRow };
                        const r = datum.row;
                        return (
                          <div className={styles.tooltip}>
                            <div className={styles.tooltipTime}>{formatLocalTimeLong(r.timestamp)}</div>
                            <div className={styles.tooltipRow}><strong>{r.ticker}</strong> · {r.bot}</div>
                            {r.status  && <div className={styles.tooltipRow}>status: {r.status}</div>}
                            {r.rating  && <div className={styles.tooltipRow}>rating: {r.rating}</div>}
                            {r.politician && <div className={styles.tooltipRow}>politician: {r.politician}</div>}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12, paddingBottom: 6 }}
                    />
                    <Scatter
                      name="Copy Trade"
                      data={timelineSeries.copytrade}
                      fill={COPYTRADE_COLOR}
                      shape={(props: unknown) => {
                        const { cx, cy, payload } = props as { cx: number; cy: number; payload: { row: TimelineRow } };
                        const color = STATUS_COLORS[payload.row.status ?? ""] ?? COPYTRADE_COLOR;
                        return <circle cx={cx} cy={cy} r={5} fill={color} stroke={COPYTRADE_COLOR} strokeWidth={1} />;
                      }}
                    />
                    <Scatter
                      name="Earnings Trade"
                      data={timelineSeries.earnings}
                      fill={EARNINGS_COLOR}
                      shape={(props: unknown) => {
                        const { cx, cy, payload } = props as { cx: number; cy: number; payload: { row: TimelineRow } };
                        const color = STATUS_COLORS[payload.row.status ?? ""] ?? EARNINGS_COLOR;
                        return <circle cx={cx} cy={cy} r={5} fill={color} stroke={EARNINGS_COLOR} strokeWidth={1} />;
                      }}
                    />
                    <Scatter
                      name="Indicator Alert"
                      data={timelineSeries.indicator}
                      fill={INDICATOR_COLOR}
                      shape={(props: unknown) => {
                        const { cx, cy, payload } = props as { cx: number; cy: number; payload: { row: TimelineRow } };
                        const color = STATUS_COLORS[payload.row.status ?? ""] ?? INDICATOR_COLOR;
                        return <circle cx={cx} cy={cy} r={5} fill={color} stroke={INDICATOR_COLOR} strokeWidth={1} />;
                      }}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </>
      ) : null}

      {!data && !loading && !error && (
        <Card>
          <p className={styles.empty}>
            Pick a provider and bot scope above, then click <strong>Generate Summary</strong> to produce today&apos;s debrief.
          </p>
        </Card>
      )}
    </div>
  );
}
