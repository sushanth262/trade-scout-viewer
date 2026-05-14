import { NextResponse } from "next/server";
import { alpacaDataGet, hasAlpacaCredentials } from "@/lib/alpaca-data";

type QuoteOut = { price: number; change_pct: number | null; prev_close: number | null };

const ALPACA_HINT =
  "Add ALPACA_API_KEY and ALPACA_API_SECRET to .env.local (Paper API keys: https://app.alpaca.markets/paper/dashboard/overview → API). Restart next dev after saving.";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tickers = (sp.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (!tickers.length) return NextResponse.json({});

  if (!hasAlpacaCredentials()) {
    return NextResponse.json({
      __config__: { alpaca: false, hint: ALPACA_HINT },
    });
  }

  try {
    const symParam = tickers.join(",");
    const snap = (await alpacaDataGet(
      `/v2/stocks/snapshots?symbols=${encodeURIComponent(symParam)}`,
    )) as Record<
      string,
      {
        latestTrade?: { p?: number };
        prevDailyBar?: { c?: number };
        dailyBar?: { c?: number };
      }
    >;

    const out: Record<string, QuoteOut> = {};
    for (const t of tickers) {
      const s = snap[t];
      const price = s?.latestTrade?.p ?? s?.dailyBar?.c ?? 0;
      const prev = s?.prevDailyBar?.c ?? null;
      let change_pct: number | null = null;
      if (prev && price) change_pct = ((price - prev) / prev) * 100;
      out[t] = { price, change_pct, prev_close: prev };
    }
    return NextResponse.json(out);
  } catch (err) {
    console.error("quotes:", err);
    const msg = err instanceof Error ? err.message : "quotes failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
