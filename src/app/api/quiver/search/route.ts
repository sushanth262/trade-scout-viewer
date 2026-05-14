import { NextRequest, NextResponse } from "next/server";
import { getContainer, Signal } from "@/lib/cosmos";

type Hit = { ticker: string; source: "cosmos" | "quiver"; detail?: Record<string, unknown> };

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toUpperCase();
  if (!q) return NextResponse.json({ items: [] as Hit[] });

  const hits: Hit[] = [];

  try {
    const container = await getContainer("signals");
    const cq = {
      query: 'SELECT * FROM c WHERE c.kind = "signal" AND STARTSWITH(UPPER(c.ticker), @pfx)',
      parameters: [{ name: "@pfx", value: q }],
    };
    const { resources } = await container.items.query<Signal>(cq).fetchAll();
    for (const s of resources.slice(0, 25)) {
      hits.push({ ticker: s.ticker.toUpperCase(), source: "cosmos", detail: { rating: s.rating, conviction: s.conviction } });
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
        hits.push({ ticker: q, source: "quiver", detail: Array.isArray(data) ? { rows: data.length } : { raw: data } });
      }
    } catch (e) {
      console.error("quiver live:", e);
    }
  }

  return NextResponse.json({ items: hits });
}
