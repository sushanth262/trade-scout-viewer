import { NextRequest, NextResponse } from "next/server";
import { getContainer, TradeEvent } from "@/lib/cosmos";
import { isLocalRequest, rejectExternal } from "@/lib/localhost-only";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const ticker = sp.get("ticker");
    const status = sp.get("status");
    const event = sp.get("event");
    const source = sp.get("source");
    const from = sp.get("from");
    const to = sp.get("to");
    const limit = Math.min(parseInt(sp.get("limit") ?? "100"), 500);
    const offset = parseInt(sp.get("offset") ?? "0");

    const conditions: string[] = [
      '(c.kind = "trade" OR NOT IS_DEFINED(c.kind))',
    ];
    const params: { name: string; value: string | number | boolean }[] = [];

    if (ticker) {
      conditions.push("c.ticker = @ticker");
      params.push({ name: "@ticker", value: ticker });
    }
    if (status) {
      conditions.push("c.status = @status");
      params.push({ name: "@status", value: status });
    }
    if (event) {
      conditions.push("c.event = @event");
      params.push({ name: "@event", value: event });
    }
    if (source) {
      conditions.push("c.source = @source");
      params.push({ name: "@source", value: source });
    }
    if (from) {
      conditions.push("c.timestamp >= @from");
      params.push({ name: "@from", value: from });
    }
    if (to) {
      conditions.push("c.timestamp <= @to");
      params.push({ name: "@to", value: to });
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const query = `SELECT * FROM c ${where} ORDER BY c.timestamp DESC OFFSET ${offset} LIMIT ${limit}`;
    const countQuery = `SELECT VALUE COUNT(1) FROM c ${where}`;

    const container = await getContainer("trades");
    const [{ resources }, { resources: countRes }] = await Promise.all([
      container.items.query<TradeEvent>({ query, parameters: params }).fetchAll(),
      container.items.query<number>({ query: countQuery, parameters: params }).fetchAll(),
    ]);

    return NextResponse.json({ items: resources, total: countRes[0] ?? 0 });
  } catch (err) {
    console.error("trades API error:", err);
    return NextResponse.json({ error: "Failed to fetch trades" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();

  try {
    const body: TradeEvent | TradeEvent[] = await req.json();
    const items = Array.isArray(body) ? body : [body];
    const container = await getContainer("trades");

    const results = [];
    for (const item of items) {
      const doc = { ...item, kind: "trade" };
      if (!doc.id) {
        doc.id = doc.trade_id ?? `trade-${doc.event ?? "evt"}-${doc.symbol ?? doc.ticker}-${Date.now()}`;
      }
      const { resource } = await container.items.upsert(doc);
      results.push(resource);
    }

    return NextResponse.json({ created: results.length });
  } catch (err) {
    console.error("trades POST error:", err);
    return NextResponse.json({ error: "Failed to insert trades" }, { status: 500 });
  }
}
