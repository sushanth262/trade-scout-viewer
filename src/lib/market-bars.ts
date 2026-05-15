import { alpacaDataGet, hasAlpacaCredentials } from "@/lib/alpaca-data";

export type Bar = {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BarSource = "alpaca" | "yahoo";
export type BarSourcePreference = "auto" | "alpaca" | "yahoo";

export function mapTimeframeToAlpaca(tf: string): string {
  const m: Record<string, string> = {
    "1D": "1Day",
    "1H": "1Hour",
    "15Min": "15Min",
  };
  return m[tf] ?? "1Day";
}

function mapTimeframeToYahooInterval(tf: string): string {
  const m: Record<string, string> = {
    "1D": "1d",
    "1H": "60m",
    "15Min": "15m",
  };
  return m[tf] ?? "1d";
}

function yahooRangeFor(lookbackDays: number, timeframe: string): string {
  if (timeframe === "1D") {
    if (lookbackDays <= 60) return "3mo";
    if (lookbackDays <= 180) return "6mo";
    if (lookbackDays <= 400) return "1y";
    if (lookbackDays <= 800) return "2y";
    return "5y";
  }
  if (timeframe === "1H") {
    if (lookbackDays <= 7) return "7d";
    if (lookbackDays <= 30) return "1mo";
    return "3mo";
  }
  if (lookbackDays <= 5) return "5d";
  if (lookbackDays <= 30) return "1mo";
  return "3mo";
}

/** Alpaca Data API v2 stock bars (requires ALPACA_API_KEY / SECRET). */
export async function fetchAlpacaBars(
  ticker: string,
  timeframe: string,
  lookbackDays: number,
): Promise<Bar[]> {
  if (!hasAlpacaCredentials()) return [];

  const limit = Math.min(10000, Math.max(50, lookbackDays + 60));
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - lookbackDays - 30);

  const q = new URLSearchParams({
    symbols: ticker.toUpperCase(),
    timeframe: mapTimeframeToAlpaca(timeframe),
    limit: String(limit),
    adjustment: "split",
    start: start.toISOString(),
  });

  const data = (await alpacaDataGet(`/v2/stocks/bars?${q.toString()}`)) as {
    bars?: Record<
      string,
      { t: string; o: number; h: number; l: number; c: number; v: number }[]
    >;
  };

  const raw = data.bars?.[ticker.toUpperCase()] ?? [];
  const cutoff = Date.now() - lookbackDays * 86400000;
  return raw
    .map((b) => ({
      date: new Date(b.t),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v ?? 0,
    }))
    .filter((b) => b.date.getTime() >= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Yahoo v8 chart API — daily and intraday (1h, 15m). */
export async function fetchYahooBars(
  ticker: string,
  timeframe: string,
  lookbackDays: number,
): Promise<Bar[]> {
  const interval = mapTimeframeToYahooInterval(timeframe);
  const range = yahooRangeFor(lookbackDays, timeframe);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "TradeScoutViewer/1.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: Record<string, unknown>[] } }[] };
  };
  const r = json.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error("Yahoo returned no bars");
  const q = r.indicators?.quote?.[0] as {
    open?: (number | null)[];
    high?: (number | null)[];
    low?: (number | null)[];
    close?: (number | null)[];
    volume?: (number | null)[];
  };
  if (!q) throw new Error("Yahoo quote array missing");

  const bars: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = q.close?.[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({
      date: new Date((r.timestamp[i] as number) * 1000),
      open: q.open?.[i] ?? c,
      high: q.high?.[i] ?? c,
      low: q.low?.[i] ?? c,
      close: c,
      volume: q.volume?.[i] ?? 0,
    });
  }
  const cutoff = Date.now() - lookbackDays * 86400000;
  return bars.filter((b) => b.date.getTime() >= cutoff).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Prefer Alpaca; fall back to Yahoo (all supported timeframes). */
export async function fetchMarketBars(
  ticker: string,
  timeframe: string,
  lookbackDays: number,
  sourcePref: BarSourcePreference = "auto",
): Promise<{ bars: Bar[]; source: BarSource; note?: string }> {
  const sym = ticker.toUpperCase();
  const days = Math.min(Math.max(7, lookbackDays), 365 * 5);
  const notes: string[] = [];

  if (sourcePref === "yahoo") {
    const yahoo = await fetchYahooBars(sym, timeframe, days);
    if (!yahoo.length) throw new Error("Yahoo returned no bars");
    return { bars: yahoo, source: "yahoo" };
  }

  if (sourcePref === "alpaca" || sourcePref === "auto") {
    try {
      const alpaca = await fetchAlpacaBars(sym, timeframe, days);
      if (alpaca.length > 0) return { bars: alpaca, source: "alpaca" };
      if (sourcePref === "alpaca") {
        throw new Error("Alpaca returned no bars for this symbol/timeframe");
      }
      notes.push("Alpaca returned no bars");
    } catch (e) {
      if (sourcePref === "alpaca") {
        throw e instanceof Error ? e : new Error(String(e));
      }
      notes.push(e instanceof Error ? e.message : "Alpaca unavailable");
    }
  }

  const yahoo = await fetchYahooBars(sym, timeframe, days);
  if (!yahoo.length) throw new Error("No historical bars (Alpaca and Yahoo failed)");
  return {
    bars: yahoo,
    source: "yahoo",
    note: notes.length ? notes.join("; ") + " — using Yahoo" : "Yahoo fallback",
  };
}

/** Chart time: business day string for daily, unix seconds for intraday. */
export function barChartTime(d: Date, timeframe: string): string | number {
  if (timeframe === "1D") return d.toISOString().slice(0, 10);
  return Math.floor(d.getTime() / 1000);
}
