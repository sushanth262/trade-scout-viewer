"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { AlertRule, AlertState } from "@/lib/cosmos";
import { viewerWriteHeaders } from "@/lib/viewer-write-client";
import { LightweightStockChart } from "@/components/chart/LightweightStockChart";
import RuleBuilderForm from "@/components/chart/RuleBuilderForm";
import { defaultParamsForType } from "@/lib/alert-rule-presets";
import type { BarSourcePreference } from "@/lib/market-bars";
import styles from "./page.module.css";

type Tab = "rules" | "backtest";

export default function ChartPage() {
  const params = useParams();
  const ticker = String(params.ticker ?? "").toUpperCase();
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [tab, setTab] = useState<Tab>("rules");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [states, setStates] = useState<AlertState[]>([]);
  const [lookback, setLookback] = useState(90);
  const [chartTimeframe, setChartTimeframe] = useState<AlertRule["timeframe"]>("1D");
  const [barSource, setBarSource] = useState<BarSourcePreference>("auto");
  const [chartRefresh, setChartRefresh] = useState(0);
  const [btResult, setBtResult] = useState<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  const [name, setName] = useState("EMA cross");
  const [ruleType, setRuleType] = useState<AlertRule["rule_type"]>("ema_crossover");
  const [timeframe, setTimeframe] = useState<AlertRule["timeframe"]>("1D");
  const [ruleParams, setRuleParams] = useState<Record<string, unknown>>(
    defaultParamsForType("ema_crossover"),
  );

  const loadRules = useCallback(async () => {
    if (!ticker) return;
    const r = await fetch(`${base}/api/alert-rules?ticker=${encodeURIComponent(ticker)}`);
    const j = (await r.json()) as { items?: AlertRule[] };
    setRules(j.items ?? []);
    const s = await fetch(`${base}/api/alert-states?ticker=${encodeURIComponent(ticker)}`);
    const sj = (await s.json()) as { items?: AlertState[] };
    setStates(sj.items ?? []);
  }, [base, ticker]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  /** Saved rules default to 1D — align chart timeframe so overlays/triggers render. */
  useEffect(() => {
    const enabled = rules.filter((r) => r.enabled !== false);
    if (!enabled.length) return;
    const onChart = enabled.filter((r) => r.timeframe === chartTimeframe);
    if (onChart.length > 0) return;
    const counts = new Map<AlertRule["timeframe"], number>();
    for (const r of enabled) {
      counts.set(r.timeframe, (counts.get(r.timeframe) ?? 0) + 1);
    }
    let best: AlertRule["timeframe"] = enabled[0].timeframe;
    let bestN = 0;
    for (const [tf, n] of counts) {
      if (n > bestN) {
        bestN = n;
        best = tf;
      }
    }
    setChartTimeframe(best);
    setChartRefresh((n) => n + 1);
  }, [rules, chartTimeframe]);

  const addRule = async () => {
    setRuleErr(null);
    const res = await fetch(`${base}/api/alert-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...viewerWriteHeaders() },
      body: JSON.stringify({
        ticker,
        name,
        rule_type: ruleType,
        params: ruleParams,
        timeframe,
        enabled: true,
      }),
    });
    if (!res.ok) {
      let msg = await res.text();
      try {
        const j = JSON.parse(msg) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* raw */
      }
      setRuleErr(msg || res.statusText);
      return;
    }
    await loadRules();
    setChartRefresh((n) => n + 1);
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    setRuleErr(null);
    const res = await fetch(`${base}/api/alert-rules?id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...viewerWriteHeaders() },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      setRuleErr(await res.text());
      return;
    }
    await loadRules();
    setChartRefresh((n) => n + 1);
  };

  const deleteRule = async (id: string) => {
    setRuleErr(null);
    const res = await fetch(`${base}/api/alert-rules?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { ...viewerWriteHeaders() },
    });
    if (!res.ok) {
      setRuleErr(await res.text());
      return;
    }
    await loadRules();
    setChartRefresh((n) => n + 1);
  };

  const runBacktest = async () => {
    setBusy(true);
    setBtResult(null);
    try {
      const res = await fetch(`${base}/api/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          rules,
          lookback_days: lookback,
        }),
      });
      const j = await res.json();
      setBtResult(j);
    } finally {
      setBusy(false);
    }
  };

  if (!ticker) {
    return <p>Invalid ticker</p>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link href="/watchlist" className={styles.back}>
          ← Watchlist
        </Link>
        <h1 className={styles.title}>{ticker}</h1>
      </div>

      <div className={styles.chartControls}>
        <label className={styles.chartLabel}>
          Chart timeframe
          <select
            value={chartTimeframe}
            onChange={(e) => {
              setChartTimeframe(e.target.value as AlertRule["timeframe"]);
              setChartRefresh((n) => n + 1);
            }}
          >
            <option value="1D">1D</option>
            <option value="1H">1H</option>
            <option value="15Min">15Min</option>
          </select>
        </label>
        <label className={styles.chartLabel}>
          Bar source
          <select
            value={barSource}
            onChange={(e) => {
              setBarSource(e.target.value as BarSourcePreference);
              setChartRefresh((n) => n + 1);
            }}
          >
            <option value="auto">Auto (Alpaca → Yahoo)</option>
            <option value="alpaca">Alpaca only</option>
            <option value="yahoo">Yahoo only</option>
          </select>
        </label>
        <label className={styles.chartLabel}>
          History
          <select
            value={lookback}
            onChange={(e) => {
              setLookback(Number(e.target.value));
              setChartRefresh((n) => n + 1);
            }}
          >
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
            <option value={730}>2 years (EMA 200)</option>
          </select>
        </label>
      </div>
      <LightweightStockChart
        ticker={ticker}
        basePath={base}
        timeframe={chartTimeframe}
        lookbackDays={lookback}
        barSource={barSource}
        refreshKey={chartRefresh}
        rules={rules}
      />
      <p className={styles.muted}>
        OHLCV from Alpaca or Yahoo (intraday supported on Yahoo). Chart draws EMA lines per rule, plus RSI and MACD
        panes when those rule types are enabled. Triggers match <strong>indicator-alert-bot</strong>.
      </p>

      <div className={styles.tabs}>
        <button type="button" className={tab === "rules" ? styles.tabOn : styles.tab} onClick={() => setTab("rules")}>
          Alert rules
        </button>
        <button
          type="button"
          className={tab === "backtest" ? styles.tabOn : styles.tab}
          onClick={() => setTab("backtest")}
        >
          Backtest
        </button>
      </div>

      {tab === "rules" && (
        <div className={styles.panel}>
          <p className={styles.muted}>
            Rules here drive <strong>indicator-alert-bot</strong> (technical signals + email approval).{" "}
            <strong>copytrade</strong> / <strong>earnings-trade</strong> use politician + earnings screens elsewhere in
            TradeHawk.
          </p>
          {ruleErr && <p className={styles.err}>{ruleErr}</p>}
          <h2 className={styles.h2}>Rules</h2>
          <ul className={styles.ruleList}>
            {rules.map((r) => (
              <li key={r.id} className={styles.ruleRow}>
                <span>
                  <strong>{r.name}</strong> — {r.rule_type} ({r.timeframe}){" "}
                  <span className={styles.muted}>{r.enabled ? "on" : "off"}</span>
                </span>
                <span>
                  <button type="button" className={styles.smallBtn} onClick={() => toggleRule(r.id, !r.enabled)}>
                    Toggle
                  </button>
                  <button type="button" className={styles.smallBtn} onClick={() => deleteRule(r.id)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <h3 className={styles.h3}>Add rule</h3>
          <RuleBuilderForm
            name={name}
            ruleType={ruleType}
            timeframe={timeframe}
            params={ruleParams}
            onNameChange={setName}
            onRuleTypeChange={setRuleType}
            onTimeframeChange={setTimeframe}
            onParamsChange={setRuleParams}
          />
          <button type="button" className={styles.primary} onClick={addRule}>
            Save rule
          </button>

          <h3 className={styles.h3}>Recent alert states</h3>
          <ul className={styles.states}>
            {states.map((s) => (
              <li key={s.id}>
                {s.rule_name} — <code>{s.status}</code> @ {s.fired_at.slice(0, 16)}
              </li>
            ))}
            {!states.length && <li className={styles.muted}>None yet</li>}
          </ul>
        </div>
      )}

      {tab === "backtest" && (
        <div className={styles.panel}>
          <label>
            Lookback (days){" "}
            <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))}>
              <option value={30}>30</option>
              <option value={90}>90</option>
              <option value={180}>180</option>
              <option value={365}>365</option>
            </select>
          </label>
          <button type="button" className={styles.primary} disabled={busy || !rules.length} onClick={runBacktest}>
            {busy ? "Running…" : "Run backtest"}
          </button>
          {!rules.length && <p className={styles.muted}>Add at least one enabled rule first.</p>}
          {btResult && (
            <pre className={styles.pre}>{JSON.stringify(btResult, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
