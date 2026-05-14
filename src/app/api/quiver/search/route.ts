import { NextRequest, NextResponse } from "next/server";
import { getContainer, Signal } from "@/lib/cosmos";
import { isValidEquityTicker, normalizeTicker } from "@/lib/ticker";

type Hit = { ticker: string; source: "cosmos" | "quiver"; detail?: Record<string, unknown> };

function extractTickerFromRow(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const raw = o.Ticker ?? o.ticker ?? o.symbol ?? o.Symbol;
  if (typeof raw !== "string") return null;
  const t = normalizeTicker(raw);
  return isValidEquityTicker(t) ? t : null;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toUpperCase();
  if (!q) return NextResponse.json({ items: [] as Hit[] });

  const hits: Hit[] = [];
  const seen = new Set<string>();

  const push = (ticker: string, source: Hit["source"], detail?: Record<string, unknown>) => {
    const t = normalizeTicker(ticker);
    if (!isValidEquityTicker(t) || seen.has(t)) return;
    seen.add(t);
    hits.push({ ticker: t, source, detail });
  };

  try {
    const container = await getContainer("signals");
    const cq = {
      query: 'SELECT * FROM c WHERE c.kind = "signal" AND STARTSWITH(UPPER(c.ticker), @pfx)',
      parameters: [{ name: "@pfx", value: q }],
    };
    const { resources } = await container.items.query<Signal>(cq).fetchAll();
    for (const s of resources.slice(0, 25)) {
      push(s.ticker, "cosmos", { rating: s.rating, conviction: s.conviction });
    }
  } catch (e) {
    console.error("quiver search cosmos:", e);
  }

  const key = process.env.QUIVER_API_KEY;
  if (key) {
    try {
      const url = `https://api.quiverquant.com/beta/live/congresstrading?ticker=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Token ${key}` },
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        if (Array.isArray(data)) {
          for (const row of data) {
            const t = extractTickerFromRow(row);
            if (t) push(t, "quiver", { rows: data.length });
            if (hits.length >= 40) break;
          }
        }
      }
    } catch (e) {
      console.error("quiver live:", e);
    }
  }

  return NextResponse.json({ items: hits.slice(0, 30) });
}
