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

export function mapTimeframeToAlpaca(tf: string): string {
  const m: Record<string, string> = {
    "1D": "1Day",
    "1H": "1Hour",
    "15Min": "15Min",
  };
  return m[tf] ?? "1Day";
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

/** Yahoo v8 chart API fallback when Alpaca is unavailable. */
export async function fetchYahooBars(ticker: string, lookbackDays: number): Promise<Bar[]> {
  const range =
    lookbackDays <= 60 ? "3mo" : lookbackDays <= 180 ? "6mo" : lookbackDays <= 400 ? "1y" : "2y";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?interval=1d&range=${range}`;
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
  return bars.filter((b) => b.date.getTime() >= cutoff);
}

/** Prefer Alpaca; fall back to Yahoo (daily only for Yahoo). */
export async function fetchMarketBars(
  ticker: string,
  timeframe: string,
  lookbackDays: number,
): Promise<{ bars: Bar[]; source: BarSource }> {
  const sym = ticker.toUpperCase();
  const days = Math.min(Math.max(7, lookbackDays), 365 * 5);

  try {
    const alpaca = await fetchAlpacaBars(sym, timeframe, days);
    if (alpaca.length > 0) return { bars: alpaca, source: "alpaca" };
  } catch (e) {
    console.warn("Alpaca bars:", e);
  }

  if (timeframe !== "1D") {
    throw new Error("Alpaca unavailable — only daily bars supported via Yahoo fallback");
  }

  const yahoo = await fetchYahooBars(sym, days);
  if (!yahoo.length) throw new Error("No historical bars");
  return { bars: yahoo, source: "yahoo" };
}

/** Chart time: business day string for daily, unix seconds for intraday. */
export function barChartTime(d: Date, timeframe: string): string | number {
  if (timeframe === "1D") return d.toISOString().slice(0, 10);
  return Math.floor(d.getTime() / 1000);
}
