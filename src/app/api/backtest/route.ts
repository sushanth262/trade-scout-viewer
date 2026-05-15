import { NextRequest, NextResponse } from "next/server";
import type { AlertRule } from "@/lib/cosmos";
import { ATR, MFI } from "technicalindicators";
import { fetchMarketBars } from "@/lib/market-bars";
import { computeChartSeries, normalizeAlertRule } from "@/lib/alert-rule-eval";

export const runtime = "nodejs";

type Trigger = { date: string; price: number; rule: string; direction: string };
type Trade = { entry: string; exit: string; entry_price: number; exit_price: number; pnl_pct: number };

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
    const rules = body.rules.filter((r) => r.enabled !== false).map(normalizeAlertRule);
    const lookback = Math.min(Math.max(7, body.lookback_days), 365 * 5);

    const { bars, source } = await fetchMarketBars(ticker, "1D", lookback);
    if (!bars.length) {
      return NextResponse.json({ error: "No historical data" }, { status: 404 });
    }

    const sorted = bars.sort((a, b) => a.date.getTime() - b.date.getTime());
    const series = computeChartSeries(sorted, rules, "1D");
    const closes = sorted.map((b) => b.close);
    const highs = sorted.map((b) => b.high);
    const lows = sorted.map((b) => b.low);
    const vols = sorted.map((b) => b.volume);

    const triggers: Trigger[] = series.triggers.map((t) => ({
      date: String(t.time),
      price: t.price,
      rule: t.rule,
      direction: t.direction,
    }));

    const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const mfi = MFI.calculate({
      high: highs,
      low: lows,
      close: closes,
      volume: vols,
      period: 14,
    });

    const holdDays = 5;
    const trades: Trade[] = [];
    let pos: { idx: number; price: number } | null = null;
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      const d = sorted[i].date.toISOString().slice(0, 10);
      const dayTriggers = triggers.filter((t) => t.date === d);
      const bull = dayTriggers.some((t) => t.direction === "bullish");
      const bear = dayTriggers.some((t) => t.direction === "bearish");
      if (!pos && bull) {
        pos = { idx: i, price: sorted[i].close };
      } else if (pos) {
        const held = i - pos.idx;
        if (bear || held >= holdDays) {
          const exit = sorted[i].close;
          trades.push({
            entry: sorted[pos.idx].date.toISOString().slice(0, 10),
            exit: sorted[i].date.toISOString().slice(0, 10),
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
        source,
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
