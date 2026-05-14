import { NextResponse } from "next/server";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";

type Row = { ticker: string; source: string };

const ALPACA_HINT =
  "Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.local, then restart the dev server. Keys: https://app.alpaca.markets/paper/dashboard/overview → API.";

/** Read-only symbol discovery; uses server Alpaca keys. */
export async function GET() {
  if (!hasAlpacaCredentials()) {
    return NextResponse.json({
      items: [] as Row[],
      configured: false,
      hint: ALPACA_HINT,
    });
  }

  try {
    const rows: Row[] = [];
    const seen = new Set<string>();

    const push = (t: string | undefined, source: string) => {
      if (!t) return;
      const u = t.toUpperCase();
      if (seen.has(u)) return;
      seen.add(u);
      rows.push({ ticker: u, source });
    };

    const positions = (await alpacaTradingGet("/v2/positions")) as { symbol?: string }[];
    if (Array.isArray(positions)) {
      for (const p of positions) push(p.symbol, "alpaca_position");
    }

    const watchlists = (await alpacaTradingGet("/v2/watchlists")) as { id?: string; name?: string }[];
    if (Array.isArray(watchlists)) {
      for (const wl of watchlists) {
        if (!wl.id) continue;
        const detail = (await alpacaTradingGet(`/v2/watchlists/${wl.id}`)) as {
          symbols?: string[];
        };
        for (const s of detail.symbols ?? []) push(s, `alpaca_watchlist:${wl.name ?? wl.id}`);
      }
    }

    const orders = (await alpacaTradingGet("/v2/orders?status=all&limit=500")) as { symbol?: string }[];
    if (Array.isArray(orders)) {
      for (const o of orders) push(o.symbol, "alpaca_order");
    }

    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error("alpaca search:", err);
    const msg = err instanceof Error ? err.message : "Alpaca search failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
