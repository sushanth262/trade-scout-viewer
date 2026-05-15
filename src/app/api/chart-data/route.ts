import { NextRequest, NextResponse } from "next/server";
import { getContainer, type AlertRule, type AlertState } from "@/lib/cosmos";
import { fetchMarketBars, barChartTime } from "@/lib/market-bars";
import { computeChartSeries, emaPeriodsFromRules } from "@/lib/alert-rule-eval";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const ticker = (req.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: "ticker required" }, { status: 400 });
    }

    const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "1D";
    const days = Math.min(
      365 * 5,
      Math.max(7, Number.parseInt(req.nextUrl.searchParams.get("days") ?? "365", 10) || 365),
    );

    const container = await getContainer("trades");
    const [rulesRes, statesRes] = await Promise.all([
      container.items
        .query<AlertRule>({
          query: `SELECT * FROM c WHERE c.kind = "alert_rule" AND c.ticker = @ticker`,
          parameters: [{ name: "@ticker", value: ticker }],
        })
        .fetchAll(),
      container.items
        .query<AlertState>({
          query: `SELECT TOP 40 * FROM c WHERE c.kind = "alert_state" AND c.ticker = @ticker ORDER BY c.fired_at DESC`,
          parameters: [{ name: "@ticker", value: ticker }],
        })
        .fetchAll(),
    ]);

    const rules = rulesRes.resources ?? [];
    const { bars, source } = await fetchMarketBars(ticker, timeframe, days);
    if (!bars.length) {
      return NextResponse.json({ error: "No bars returned" }, { status: 404 });
    }

    const candles = bars.map((b) => ({
      time: barChartTime(b.date, timeframe),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    const series = computeChartSeries(bars, rules, timeframe);
    const emaPeriods = emaPeriodsFromRules(rules);

    const firedMarkers = (statesRes.resources ?? []).map((s) => ({
      time: barChartTime(new Date(s.fired_at), timeframe),
      price: s.price_at_fire,
      rule: s.rule_name,
      direction: (s.bot_action === "SELL" ? "bearish" : "bullish") as "bullish" | "bearish",
      status: s.status,
      source: "fired" as const,
    }));

    return NextResponse.json({
      ticker,
      timeframe,
      source,
      emaPeriods,
      candles,
      emaFast: series.emaFast,
      emaSlow: series.emaSlow,
      priceLevels: series.priceLevels,
      triggers: series.triggers,
      firedMarkers,
    });
  } catch (err) {
    console.error("chart-data:", err);
    const msg = err instanceof Error ? err.message : "chart-data failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
