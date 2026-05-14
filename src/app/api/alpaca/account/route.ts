import { NextResponse } from "next/server";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";

const HINT =
  "Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.local, then restart the dev server.";

/** Paper/live account balances and buying power from Alpaca. */
export async function GET() {
  if (!hasAlpacaCredentials()) {
    return NextResponse.json({ configured: false, hint: HINT });
  }
  try {
    const a = (await alpacaTradingGet("/v2/account")) as Record<string, unknown>;
    return NextResponse.json({
      configured: true,
      currency: a.currency ?? "USD",
      equity: a.equity,
      last_equity: a.last_equity,
      cash: a.cash,
      portfolio_value: a.portfolio_value,
      buying_power: a.buying_power,
      daytrading_buying_power: a.daytrading_buying_power,
      pattern_day_trader: a.pattern_day_trader,
      status: a.status,
    });
  } catch (err) {
    console.error("alpaca account:", err);
    const msg = err instanceof Error ? err.message : "account fetch failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
