import { NextRequest, NextResponse } from "next/server";
import type { AlertRule } from "@/lib/cosmos";
import { EMA, RSI, MACD, ATR, MFI } from "technicalindicators";

export const runtime = "nodejs";

type Bar = { date: Date; open: number; high: number; low: number; close: number; volume: number };

type Trigger = { date: string; price: number; rule: string; direction: string };
type Trade = { entry: string; exit: string; entry_price: number; exit_price: number; pnl_pct: number };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Yahoo v8 chart API (no npm chart client — avoids bundler issues). */
async function fetchYahooDaily(ticker: string, lookbackDays: number): Promise<Bar[]> {
  const range =
    lookbackDays <= 60 ? "3mo" : lookbackDays <= 180 ? "6mo" : lookbackDays <= 400 ? "1y" : "2y";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?interval=1d&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "TradeHawkBacktest/1.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[] }[] } }[] };
  };
  const r = json.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error("Yahoo returned no bars");
  const q = r.indicators?.quote?.[0];
  if (!q) throw new Error("Yahoo quote array missing");
  const { open, high, low, close, volume } = q as {
    open?: (number | null)[];
    high?: (number | null)[];
    low?: (number | null)[];
    close?: (number | null)[];
    volume?: (number | null)[];
  };
  const bars: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = close?.[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({
      date: new Date((r.timestamp[i] as number) * 1000),
      open: open?.[i] ?? c,
      high: high?.[i] ?? c,
      low: low?.[i] ?? c,
      close: c,
      volume: volume?.[i] ?? 0,
    });
  }
  const cutoff = Date.now() - lookbackDays * 86400000;
  return bars.filter((b) => b.date.getTime() >= cutoff);
}

function ruleHit(
  i: number,
  closes: number[],
  highs: number[],
  lows: number[],
  vols: number[],
  emaF: (number | undefined)[],
  emaS: (number | undefined)[],
  rsi: (number | undefined)[],
  macd: { MACD?: number; signal?: number; histogram?: number }[],
  rule: AlertRule,
): "bullish" | "bearish" | null {
  const p = rule.params;
  if (rule.rule_type === "ema_crossover") {
    const dir = String(p.direction ?? "above");
    const ef = emaF[i];
    const es = emaS[i];
    const pef = i > 0 ? emaF[i - 1] : undefined;
    const pes = i > 0 ? emaS[i - 1] : undefined;
    if (ef == null || es == null || pef == null || pes == null) return null;
    if (dir === "above" || dir === "bullish_cross") {
      if (pef <= pes && ef > es) return "bullish";
      if (pef >= pes && ef < es) return "bearish";
    } else if (dir === "below" || dir === "bearish_cross") {
      if (pef >= pes && ef < es) return "bearish";
      if (pef <= pes && ef > es) return "bullish";
    }
    return null;
  }
  if (rule.rule_type === "rsi_threshold") {
    const thr = num(p.threshold) ?? 30;
    const direction = String(p.direction ?? "below");
    const rv = rsi[i];
    if (rv == null || i < 1) return null;
    const prev = rsi[i - 1];
    if (prev == null) return null;
    if (direction === "below" && prev > thr && rv <= thr) return "bullish";
    if (direction === "above" && prev < thr && rv >= thr) return "bearish";
    return null;
  }
  if (rule.rule_type === "macd_cross") {
    const direction = String(p.direction ?? "bullish");
    const cur = macd[i];
    const prev = i > 0 ? macd[i - 1] : undefined;
    if (!cur || !prev) return null;
    const ch = cur.histogram ?? (cur.MACD ?? 0) - (cur.signal ?? 0);
    const ph = prev.histogram ?? (prev.MACD ?? 0) - (prev.signal ?? 0);
    if (direction === "bullish" && ph <= 0 && ch > 0) return "bullish";
    if (direction === "bearish" && ph >= 0 && ch < 0) return "bearish";
    return null;
  }
  if (rule.rule_type === "price_level") {
    const level = num(p.level);
    const direction = String(p.direction ?? "above");
    if (!Number.isFinite(level)) return null;
    const c = closes[i];
    const pc = closes[i - 1];
    if (i < 1) return null;
    if (direction === "above" && pc <= level && c > level) return "bullish";
    if (direction === "below" && pc >= level && c < level) return "bearish";
    return null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      ticker: string;
      rules: AlertRule[];
      lookback_days: number;
    };
    if (!body?.ticker || !Array.isArray(body.rules) || !body.lookback_days) {
      return NextResponse.json(
        { error: "ticker, rules[], lookback_days required" },
        { status: 400 },
      );
    }
    const ticker = body.ticker.toUpperCase();
    const rules = body.rules.filter((r) => r.enabled !== false);
    const lookback = Math.min(Math.max(7, body.lookback_days), 365 * 5);

    const rawBars = await fetchYahooDaily(ticker, lookback);
    if (!rawBars.length) {
      return NextResponse.json({ error: "No historical data from Yahoo" }, { status: 404 });
    }

    const bars = rawBars.sort((a, b) => a.date.getTime() - b.date.getTime());
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const vols = bars.map((b) => b.volume);

    const maxSlow = Math.max(
      50,
      ...rules.map((r) => (r.rule_type === "ema_crossover" ? num(r.params.slow) || 50 : 0)),
    );
    const emaFastP = rules.find((r) => r.rule_type === "ema_crossover")
      ? num(rules.find((r) => r.rule_type === "ema_crossover")?.params.fast) || 20
      : 20;
    const emaSlowP = rules.find((r) => r.rule_type === "ema_crossover")
      ? num(rules.find((r) => r.rule_type === "ema_crossover")?.params.slow) || 50
      : 50;
    const rsiP =
      rules.find((r) => r.rule_type === "rsi_threshold")?.params.period != null
        ? num(rules.find((r) => r.rule_type === "rsi_threshold")?.params.period) || 14
        : 14;

    const emaF = EMA.calculate({ period: emaFastP, values: closes });
    const emaS = EMA.calculate({ period: emaSlowP, values: closes });
    const rsi = RSI.calculate({ period: rsiP, values: closes });
    const macd = MACD.calculate({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      values: closes,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const mfi = MFI.calculate({
      high: highs,
      low: lows,
      close: closes,
      volume: vols,
      period: 14,
    });

    const pad = <T>(arr: T[], target: number, fill: T): T[] => {
      const off = target - arr.length;
      if (off <= 0) return arr;
      return [...Array(off).fill(fill), ...arr] as T[];
    };

    const n = closes.length;
    const emaFp = pad(emaF as (number | undefined)[], n, undefined);
    const emaSp = pad(emaS as (number | undefined)[], n, undefined);
    const rsiPadded = pad(rsi as (number | undefined)[], n, undefined);
    const macdPadded = pad(
      macd as { MACD?: number; signal?: number; histogram?: number }[],
      n,
      {},
    );

    const triggers: Trigger[] = [];
    for (let i = Math.max(maxSlow, 30); i < n; i++) {
      for (const rule of rules) {
        const hit = ruleHit(
          i,
          closes,
          highs,
          lows,
          vols,
          emaFp,
          emaSp,
          rsiPadded,
          macdPadded,
          rule,
        );
        if (hit) {
          triggers.push({
            date: bars[i].date.toISOString().slice(0, 10),
            price: bars[i].close,
            rule: rule.name,
            direction: hit,
          });
        }
      }
    }

    const holdDays = 5;
    const trades: Trade[] = [];
    let pos: { idx: number; price: number } | null = null;
    for (let i = 0; i < n; i++) {
      const d = bars[i].date.toISOString().slice(0, 10);
      const dayTriggers = triggers.filter((t) => t.date === d);
      const bull = dayTriggers.some((t) => t.direction === "bullish");
      const bear = dayTriggers.some((t) => t.direction === "bearish");
      if (!pos && bull) {
        pos = { idx: i, price: bars[i].close };
      } else if (pos) {
        const held = i - pos.idx;
        if (bear || held >= holdDays) {
          const exit = bars[i].close;
          trades.push({
            entry: bars[pos.idx].date.toISOString().slice(0, 10),
            exit: bars[i].date.toISOString().slice(0, 10),
            entry_price: pos.price,
            exit_price: exit,
            pnl_pct: ((exit - pos.price) / pos.price) * 100,
          });
          pos = null;
        }
      }
    }

    const wins = trades.filter((t) => t.pnl_pct > 0).length;
    const win_rate = trades.length ? wins / trades.length : 0;
    const avg_return = trades.length
      ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length
      : 0;

    return NextResponse.json({
      triggers,
      trades,
      stats: {
        win_rate,
        avg_return,
        total_triggers: triggers.length,
        trade_count: trades.length,
      },
      meta: {
        bars: n,
        last_atr: atr[atr.length - 1],
        last_mfi: mfi[mfi.length - 1],
      },
    });
  } catch (err) {
    console.error("backtest:", err);
    const msg = err instanceof Error ? err.message : "backtest failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
