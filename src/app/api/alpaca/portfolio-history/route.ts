import { NextRequest, NextResponse } from "next/server";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";

const HINT =
  "Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.local, then restart the dev server.";

/** Equity curve for charts: GET ?period=3M&timeframe=1D */
export async function GET(req: NextRequest) {
  if (!hasAlpacaCredentials()) {
    return NextResponse.json({ configured: false, hint: HINT, points: [] as { t: string; equity: number }[] });
  }
  const sp = req.nextUrl.searchParams;
  const period = sp.get("period") ?? "3M";
  const timeframe = sp.get("timeframe") ?? "1D";
  try {
    const path = `/v2/account/portfolio/history?period=${encodeURIComponent(period)}&timeframe=${encodeURIComponent(timeframe)}`;
    const raw = (await alpacaTradingGet(path)) as {
      timestamp?: number[];
      equity?: string[];
      profit_loss?: string[];
      profit_loss_pct?: string[];
      timeframe?: string;
    };
    const ts = raw.timestamp ?? [];
    const eq = raw.equity ?? [];
    const points = ts.map((unix, i) => ({
      t: new Date(unix * 1000).toISOString(),
      equity: parseFloat(eq[i] ?? "0") || 0,
      pl: parseFloat(raw.profit_loss?.[i] ?? "0") || 0,
      pl_pct: parseFloat(raw.profit_loss_pct?.[i] ?? "0") || 0,
    }));
    return NextResponse.json({
      configured: true,
      period,
      timeframe: raw.timeframe ?? timeframe,
      points,
    });
  } catch (err) {
    console.error("portfolio-history:", err);
    const msg = err instanceof Error ? err.message : "portfolio history failed";
    return NextResponse.json({ error: msg, points: [] }, { status: 502 });
  }
}
