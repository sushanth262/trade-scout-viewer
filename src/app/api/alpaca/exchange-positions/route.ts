import { NextResponse } from "next/server";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";

const HINT =
  "Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.local, then restart the dev server.";

type AlpacaPos = {
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  avg_entry_price: string;
  current_price: string;
};

type AlpacaOrder = {
  symbol: string;
  side: string;
  filled_avg_price?: string | null;
  filled_qty?: string | null;
  status: string;
  filled_at?: string | null;
  submitted_at?: string | null;
  asset_class?: string;
};

/** Open positions at Alpaca + recent closed (filled sell) orders for UI merge. */
export async function GET() {
  if (!hasAlpacaCredentials()) {
    return NextResponse.json({
      configured: false,
      hint: HINT,
      open: [] as AlpacaPos[],
      closedSells: [] as { symbol: string; qty: string; exit_price: number; filled_at: string | null }[],
    });
  }
  try {
    const rawPos = await alpacaTradingGet("/v2/positions");
    const open = (Array.isArray(rawPos) ? rawPos : []) as AlpacaPos[];
    const rawOrders = await alpacaTradingGet("/v2/orders?status=closed&limit=200&direction=desc");
    const orders = (Array.isArray(rawOrders) ? rawOrders : []) as AlpacaOrder[];
    const closedSellsRaw: { symbol: string; qty: string; exit_price: number; filled_at: string | null }[] = [];
    const seen = new Set<string>();
    for (const o of orders) {
      if (o.asset_class && o.asset_class !== "us_equity") continue;
      if (o.side !== "sell") continue;
      if (!o.symbol || !o.filled_avg_price) continue;
      const px = parseFloat(o.filled_avg_price);
      if (!Number.isFinite(px) || px <= 0) continue;
      const sym = o.symbol.toUpperCase();
      const key = `${sym}|${o.filled_at ?? o.submitted_at ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      closedSellsRaw.push({
        symbol: sym,
        qty: o.filled_qty ?? "0",
        exit_price: px,
        filled_at: o.filled_at ?? o.submitted_at ?? null,
      });
    }
    const latestBySymbol = new Map<string, (typeof closedSellsRaw)[0]>();
    for (const c of closedSellsRaw) {
      const prev = latestBySymbol.get(c.symbol);
      const t = c.filled_at ?? "";
      const pt = prev?.filled_at ?? "";
      if (!prev || t > pt) latestBySymbol.set(c.symbol, c);
    }
    const closedSells = [...latestBySymbol.values()];
    return NextResponse.json({
      configured: true,
      open: open.map((p) => ({ ...p, symbol: (p.symbol ?? "").toUpperCase() })),
      closedSells,
    });
  } catch (err) {
    console.error("exchange-positions:", err);
    const msg = err instanceof Error ? err.message : "exchange positions failed";
    return NextResponse.json({ error: msg, open: [], closedSells: [] }, { status: 502 });
  }
}
