import { NextRequest, NextResponse } from "next/server";
import { getContainer, type AlertRule, type AlertState } from "@/lib/cosmos";
import { fetchMarketBars, barChartTime, type BarSourcePreference } from "@/lib/market-bars";
import {
  computeChartSeries,
  emaPeriodsFromRules,
  filterRulesForChart,
  normalizeAlertRule,
} from "@/lib/alert-rule-eval";

export const runtime = "nodejs";

type ChartDataBody = {
  ticker?: string;
  timeframe?: string;
  days?: number;
  source?: string;
  rules?: AlertRule[];
};

async function loadRulesFromCosmos(ticker: string): Promise<AlertRule[]> {
  const container = await getContainer("trades");
  const { resources } = await container.items
    .query<AlertRule>({
      query: `SELECT * FROM c WHERE c.kind = "alert_rule" AND c.ticker = @ticker`,
      parameters: [{ name: "@ticker", value: ticker }],
    })
    .fetchAll();
  return (resources ?? []).map(normalizeAlertRule);
}

async function loadFiredMarkers(ticker: string, timeframe: string) {
  const container = await getContainer("trades");
  const { resources } = await container.items
    .query<AlertState>({
      query: `SELECT TOP 40 * FROM c WHERE c.kind = "alert_state" AND c.ticker = @ticker ORDER BY c.fired_at DESC`,
      parameters: [{ name: "@ticker", value: ticker }],
    })
    .fetchAll();
  return (resources ?? []).map((s) => ({
    time: barChartTime(new Date(s.fired_at), timeframe),
    price: s.price_at_fire,
    rule: s.rule_name,
    direction: (s.bot_action === "SELL" ? "bearish" : "bullish") as "bullish" | "bearish",
    status: s.status,
    source: "fired" as const,
  }));
}

async function buildChartPayload(
  ticker: string,
  timeframe: string,
  days: number,
  sourcePref: BarSourcePreference,
  rulesInput: AlertRule[] | null,
) {
  const allRules = rulesInput ?? (await loadRulesFromCosmos(ticker));
  const enabled = allRules.filter((r) => r.enabled !== false);
  const rules = filterRulesForChart(enabled, timeframe);
  const skipped = enabled
    .filter((r) => r.timeframe !== timeframe)
    .map((r) => ({ name: r.name, timeframe: r.timeframe, reason: "timeframe_mismatch" as const }));

  const { bars, source, note } = await fetchMarketBars(ticker, timeframe, days, sourcePref);
  if (!bars.length) {
    return { error: "No bars returned", status: 404 as const };
  }

  const candles = bars.map((b) => ({
    time: barChartTime(b.date, timeframe),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));

  const series = computeChartSeries(bars, enabled, timeframe);
  const emaPeriods = emaPeriodsFromRules(rules);
  const firedMarkers = await loadFiredMarkers(ticker, timeframe);

  return {
    status: 200 as const,
    body: {
      ticker,
      timeframe,
      source,
      sourceNote: note,
      emaPeriods,
      candles,
      emaFast: series.emaFast,
      emaSlow: series.emaSlow,
      emaOverlays: series.emaOverlays,
      rsi: series.rsi,
      macd: series.macd,
      priceLevels: series.priceLevels,
      triggers: series.triggers,
      firedMarkers,
      appliedRules: rules.map((r) => ({ name: r.name, rule_type: r.rule_type, timeframe: r.timeframe })),
      skippedRules: skipped,
      rulesTotal: enabled.length,
      rulesApplied: rules.length,
    },
  };
}

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
    const sourceParam = (req.nextUrl.searchParams.get("source") ?? "auto").toLowerCase();
    const sourcePref: BarSourcePreference =
      sourceParam === "alpaca" || sourceParam === "yahoo" ? sourceParam : "auto";

    const result = await buildChartPayload(ticker, timeframe, days, sourcePref, null);
    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.body);
  } catch (err) {
    console.error("chart-data GET:", err);
    const msg = err instanceof Error ? err.message : "chart-data failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST with client rules[] — same source as backtest tab. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChartDataBody;
    const ticker = (body.ticker ?? "").trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: "ticker required" }, { status: 400 });
    }

    const timeframe = body.timeframe ?? "1D";
    const days = Math.min(
      365 * 5,
      Math.max(7, Number.parseInt(String(body.days ?? 365), 10) || 365),
    );
    const sourceParam = (body.source ?? "auto").toLowerCase();
    const sourcePref: BarSourcePreference =
      sourceParam === "alpaca" || sourceParam === "yahoo" ? sourceParam : "auto";
    const rules =
      Array.isArray(body.rules) && body.rules.length > 0
        ? body.rules.map(normalizeAlertRule)
        : null;

    const result = await buildChartPayload(ticker, timeframe, days, sourcePref, rules);
    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.body);
  } catch (err) {
    console.error("chart-data POST:", err);
    const msg = err instanceof Error ? err.message : "chart-data failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
