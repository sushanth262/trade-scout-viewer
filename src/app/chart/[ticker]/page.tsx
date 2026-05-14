"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { AlertRule, AlertState } from "@/lib/cosmos";
import { viewerWriteHeaders } from "@/lib/viewer-write-client";
import styles from "./page.module.css";

function TradingViewEmbed({ ticker }: { ticker: string }) {
  const sym = ticker.includes(":") ? ticker : `NASDAQ:${ticker}`;
  const src = `https://www.tradingview.com/widgetembed/?frameElementId=tv_${ticker}&symbol=${encodeURIComponent(
    sym,
  )}&interval=D&hidesidetoolbar=0&symboledit=1&saveimage=0&toolbarbg=1f2937&studies=%5B%7B%22id%22%3A%22MAExp%40tv-basicstudies%22%2C%22inputs%22%3A%7B%22length%22%3A20%7D%7D%2C%7B%22id%22%3A%22MAExp%40tv-basicstudies%22%2C%22inputs%22%3A%7B%22length%22%3A50%7D%7D%2C%7B%22id%22%3A%22MAExp%40tv-basicstudies%22%2C%22inputs%22%3A%7B%22length%22%3A200%7D%7D%2C%7B%22id%22%3A%22RSI%40tv-basicstudies%22%2C%22inputs%22%3A%7B%22length%22%3A14%7D%7D%2C%7B%22id%22%3A%22MACD%40tv-basicstudies%22%2C%22inputs%22%3A%7B%7D%7D%2C%7B%22id%22%3A%22Volume%40tv-basicstudies%22%2C%22inputs%22%3A%7B%7D%7D%2C%7B%22id%22%3A%22ATR%40tv-basicstudies%22%2C%22inputs%22%3A%7B%22length%22%3A14%7D%7D%2C%7B%22id%22%3A%22MFI%40tv-basicstudies%22%2C%22inputs%22%3A%7B%22length%22%3A14%7D%7D%5D&theme=dark&style=1&timezone=America%2FNew_York`;

  return (
    <div className={styles.tvWrap}>
      <iframe className={styles.tvFrame} title={`Chart ${ticker}`} src={src} />
    </div>
  );
}

type Tab = "rules" | "backtest";

export default function ChartPage() {
  const params = useParams();
  const ticker = String(params.ticker ?? "").toUpperCase();
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [tab, setTab] = useState<Tab>("rules");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [states, setStates] = useState<AlertState[]>([]);
  const [lookback, setLookback] = useState(90);
  const [btResult, setBtResult] = useState<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  const [name, setName] = useState("EMA cross");
  const [ruleType, setRuleType] = useState<AlertRule["rule_type"]>("ema_crossover");
  const [timeframe, setTimeframe] = useState<AlertRule["timeframe"]>("1D");
  const [paramsJson, setParamsJson] = useState('{"fast":20,"slow":50,"direction":"bullish_cross"}');

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

  const addRule = async () => {
    setRuleErr(null);
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramsJson) as Record<string, unknown>;
    } catch {
      setRuleErr("Invalid JSON for params");
      return;
    }
    const res = await fetch(`${base}/api/alert-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...viewerWriteHeaders() },
      body: JSON.stringify({
        ticker,
        name,
        rule_type: ruleType,
        params,
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
        <Link href={`${base}/watchlist`} className={styles.back}>
          ← Watchlist
        </Link>
        <h1 className={styles.title}>{ticker}</h1>
      </div>

      <TradingViewEmbed ticker={ticker} />

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
          <div className={styles.form}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Type
              <select value={ruleType} onChange={(e) => setRuleType(e.target.value as AlertRule["rule_type"])}>
                <option value="ema_crossover">EMA crossover</option>
                <option value="rsi_threshold">RSI threshold</option>
                <option value="macd_cross">MACD cross</option>
                <option value="price_level">Price level</option>
              </select>
            </label>
            <label>
              Timeframe
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as AlertRule["timeframe"])}>
                <option value="1D">1D</option>
                <option value="1H">1H</option>
                <option value="15Min">15Min</option>
              </select>
            </label>
            <label className={styles.full}>
              Params (JSON)
              <textarea rows={4} value={paramsJson} onChange={(e) => setParamsJson(e.target.value)} />
            </label>
            <button type="button" className={styles.primary} onClick={addRule}>
              Save rule
            </button>
          </div>

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
