"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import { viewerWriteHeaders } from "@/lib/viewer-write-client";
import type { WatchlistEntry, Signal, AlertState } from "@/lib/cosmos";
import styles from "./page.module.css";

type Tab = "alpaca" | "quiver";

type QuoteRow = { price: number; change_pct: number | null; prev_close: number | null };

function splitQuotesPayload(raw: Record<string, unknown>): { prices: Record<string, QuoteRow>; hint: string | null } {
  const cfg = raw.__config__ as { alpaca?: boolean; hint?: string } | undefined;
  const hint = cfg?.alpaca === false && typeof cfg.hint === "string" ? cfg.hint : null;
  const { __config__: _c, ...rest } = raw;
  return { prices: rest as Record<string, QuoteRow>, hint };
}

export default function WatchlistPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [tab, setTab] = useState<Tab>("alpaca");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<WatchlistEntry[]>([]);
  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({});
  const [signalsByTicker, setSignalsByTicker] = useState<Record<string, Signal>>({});
  const [alertCounts, setAlertCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [quoteNotice, setQuoteNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const wl = await fetchApi<{ items: WatchlistEntry[] }>("/api/watchlist");
      setRows(wl.items ?? []);
      const tickers = (wl.items ?? []).map((r) => r.ticker);
      if (tickers.length) {
        const qr = await fetch(`${basePath}/api/quotes?tickers=${encodeURIComponent(tickers.join(","))}`);
        const raw = (await qr.json()) as Record<string, unknown>;
        const { prices, hint } = splitQuotesPayload(raw);
        setQuotes(prices);
        setQuoteNotice(hint);
      } else {
        setQuotes({});
        setQuoteNotice(null);
      }
      const states = await fetchApi<{ items: AlertState[] }>("/api/alert-states", {
        limit: "500",
      }).catch(() => ({ items: [] as AlertState[] }));
      const counts: Record<string, number> = {};
      for (const a of states.items ?? []) {
        if (a.status === "pending" || a.status === "approved") {
          counts[a.ticker] = (counts[a.ticker] ?? 0) + 1;
        }
      }
      setAlertCounts(counts);
      const sigMap: Record<string, Signal> = {};
      for (const t of tickers) {
        try {
          const s = await fetchApi<{ items: Signal[] }>("/api/signals", {
            ticker: t,
            limit: "1",
          });
          const top = s.items?.[0];
          if (top) sigMap[t] = top;
        } catch {
          /* skip */
        }
      }
      setSignalsByTicker(sigMap);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      const tickers = rows.map((r) => r.ticker);
      if (!tickers.length) return;
      fetch(`${basePath}/api/quotes?tickers=${encodeURIComponent(tickers.join(","))}`)
        .then((r) => r.json())
        .then((raw: Record<string, unknown>) => {
          const { prices, hint } = splitQuotesPayload(raw);
          setQuotes(prices);
          if (hint) setQuoteNotice(hint);
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [rows, basePath]);

  const addFromSearch = async () => {
    const t = query.trim().toUpperCase();
    if (!t) return;
    setErr(null);
    try {
      const res = await fetch(`${basePath}/api/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...viewerWriteHeaders() },
        body: JSON.stringify({ ticker: t }),
      });
      if (!res.ok) {
        let msg = await res.text();
        try {
          const j = JSON.parse(msg) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* use raw */
        }
        throw new Error(msg || res.statusText);
      }
      setQuery("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add failed");
    }
  };

  const removeRow = async (ticker: string) => {
    setErr(null);
    try {
      const res = await fetch(`${basePath}/api/watchlist?ticker=${encodeURIComponent(ticker)}`, {
        method: "DELETE",
        headers: { ...viewerWriteHeaders() },
      });
      if (!res.ok) {
        let msg = await res.text();
        try {
          const j = JSON.parse(msg) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* raw */
        }
        throw new Error(msg || res.statusText);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    }
  };

  const saveNotes = async (ticker: string, notes: string) => {
    setErr(null);
    try {
      const res = await fetch(`${basePath}/api/watchlist?ticker=${encodeURIComponent(ticker)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...viewerWriteHeaders() },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        let msg = await res.text();
        try {
          const j = JSON.parse(msg) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* raw */
        }
        throw new Error(msg || res.statusText);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save notes failed");
    }
  };

  const runAlpacaSearch = async () => {
    setErr(null);
    try {
      const r = await fetch(`${basePath}/api/alpaca/search`);
      const j = (await r.json()) as {
        items?: { ticker: string; source: string }[];
        error?: string;
        configured?: boolean;
        hint?: string;
      };
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      if (j.configured === false && j.hint) {
        setQuoteNotice(j.hint);
        setQuery("");
        return;
      }
      setQuoteNotice(null);
      setQuery((j.items ?? []).map((i) => i.ticker).join(", "));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Alpaca search failed");
    }
  };

  const runQuiverSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setErr(null);
    try {
      const r = await fetch(`${basePath}/api/quiver/search?q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as { items?: { ticker: string }[] };
      const tickers = [...new Set((j.items ?? []).map((i) => i.ticker))];
      if (tickers.length) setQuery(tickers.join(", "));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Quiver search failed");
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Watchlist</h1>
      <p className={styles.subtitle}>
        Add tickers by symbol. Live prices refresh every 60s when Alpaca keys are set in{" "}
        <code className={styles.code}>.env.local</code>. Chart + alert rules use the same tickers.{" "}
        <strong>copytrade</strong> and <strong>earnings-trade</strong> execute equities from politician disclosures and
        earnings screens; <strong>indicator-alert-bot</strong> runs technical rules on watchlist symbols and only trades
        after email approval.
      </p>
      {quoteNotice && <p className={styles.notice}>{quoteNotice}</p>}
      {err && <p className={styles.err}>{err}</p>}

      <div className={styles.tabs}>
        <button type="button" className={tab === "alpaca" ? styles.tabOn : styles.tab} onClick={() => setTab("alpaca")}>
          Alpaca
        </button>
        <button type="button" className={tab === "quiver" ? styles.tabOn : styles.tab} onClick={() => setTab("quiver")}>
          Quiver
        </button>
      </div>

      <div className={styles.searchRow}>
        <input
          className={styles.input}
          placeholder="Search ticker (e.g. AAPL)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addFromSearch()}
        />
        {tab === "alpaca" ? (
          <button type="button" className={styles.btn} onClick={runAlpacaSearch}>
            Load Alpaca symbols
          </button>
        ) : (
          <button type="button" className={styles.btn} onClick={runQuiverSearch}>
            Search Quiver / Cosmos
          </button>
        )}
        <button type="button" className={styles.btnPrimary} onClick={addFromSearch}>
          Add to watchlist
        </button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Price</th>
                <th>Chg%</th>
                <th>Politicians</th>
                <th>Bot signal</th>
                <th>Alert</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const q = quotes[r.ticker];
                const sig = signalsByTicker[r.ticker];
                const nAlerts = alertCounts[r.ticker] ?? 0;
                const chg =
                  q?.change_pct != null ? `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%` : "—";
                const polRaw = sig?.politicians?.length ? sig.politicians.join(", ") : "";
                const polShort = polRaw.length > 48 ? `${polRaw.slice(0, 48)}…` : polRaw || "—";
                return (
                  <tr key={r.ticker}>
                    <td>
                      <Link className={styles.ticker} href={`${basePath}/chart/${encodeURIComponent(r.ticker)}`}>
                        {r.ticker}
                      </Link>
                    </td>
                    <td>{q?.price != null ? `$${q.price.toFixed(2)}` : "—"}</td>
                    <td>{chg}</td>
                    <td className={styles.sig} title={polRaw || undefined}>
                      {polShort}
                    </td>
                    <td className={styles.sig}>
                      {sig ? `${sig.rating} ${sig.conviction ?? ""}`.trim() : "—"}
                    </td>
                    <td>
                      {nAlerts > 0 ? (
                        <Link className={styles.badge} href={`${basePath}/chart/${encodeURIComponent(r.ticker)}`}>
                          {nAlerts} pending
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <input
                        className={styles.noteInput}
                        defaultValue={r.notes ?? ""}
                        onBlur={(e) => saveNotes(r.ticker, e.target.value)}
                      />
                    </td>
                    <td>
                      <button type="button" className={styles.linkBtn} onClick={() => removeRow(r.ticker)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <p className={styles.empty}>No symbols yet. Add one above.</p>}
        </div>
      )}
    </div>
  );
}
