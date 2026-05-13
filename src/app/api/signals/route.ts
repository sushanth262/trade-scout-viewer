import { NextRequest, NextResponse } from "next/server";
import { getContainer, Signal } from "@/lib/cosmos";
import { isLocalRequest, rejectExternal } from "@/lib/localhost-only";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const ticker = sp.get("ticker");
    const rating = sp.get("rating");
    const conviction = sp.get("conviction");
    const sector = sp.get("sector");
    const confirmed = sp.get("confirmed");
    const limit = Math.min(parseInt(sp.get("limit") ?? "100"), 500);
    const offset = parseInt(sp.get("offset") ?? "0");

    const conditions: string[] = ['c.kind = "signal"'];
    const params: { name: string; value: string | number | boolean }[] = [];

    if (ticker) {
      conditions.push("c.ticker = @ticker");
      params.push({ name: "@ticker", value: ticker });
    }
    if (rating) {
      conditions.push("c.rating = @rating");
      params.push({ name: "@rating", value: rating });
    }
    if (conviction) {
      conditions.push("c.conviction = @conviction");
      params.push({ name: "@conviction", value: conviction });
    }
    if (sector) {
      conditions.push("c.sector = @sector");
      params.push({ name: "@sector", value: sector });
    }
    if (confirmed !== null && confirmed !== undefined) {
      conditions.push("c.confirmed = @confirmed");
      params.push({ name: "@confirmed", value: confirmed === "true" });
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const query = `SELECT * FROM c ${where} ORDER BY c.screened_at DESC OFFSET ${offset} LIMIT ${limit}`;
    const countQuery = `SELECT VALUE COUNT(1) FROM c ${where}`;

    const container = await getContainer("signals");
    const [{ resources }, { resources: countRes }] = await Promise.all([
      container.items.query<Signal>({ query, parameters: params }).fetchAll(),
      container.items.query<number>({ query: countQuery, parameters: params }).fetchAll(),
    ]);

    return NextResponse.json({ items: resources, total: countRes[0] ?? 0 });
  } catch (err) {
    console.error("signals API error:", err);
    return NextResponse.json({ error: "Failed to fetch signals" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const sp = req.nextUrl.searchParams;
    const days = Math.max(1, parseFloat(sp.get("olderThanDays") ?? "30"));
    const cutoffIso = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const container = await getContainer("signals");
    let deleted = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Signals carry their own `screened_at` timestamp (not `timestamp`).
    const query = {
      query:
        'SELECT c.id, c.ticker FROM c ' +
        'WHERE c.kind = "signal" AND IS_DEFINED(c.screened_at) AND c.screened_at < @cutoff',
      parameters: [{ name: "@cutoff", value: cutoffIso }],
    };
    const iterator = container.items.query<{ id: string; ticker: string }>(
      query,
      { maxItemCount: 200 },
    );
    while (iterator.hasMoreResults()) {
      const { resources } = await iterator.fetchNext();
      for (const r of resources) {
        if (!r.ticker) { skipped++; continue; }
        try {
          await container.item(r.id, r.ticker).delete();
          deleted++;
        } catch (e) {
          errors.push(`${r.id}: ${String(e).slice(0, 80)}`);
        }
      }
    }

    return NextResponse.json({
      deleted, skipped, cutoffIso,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    console.error("signals DELETE error:", err);
    return NextResponse.json({ error: "Failed to prune signals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();

  try {
    const body: Signal | Signal[] = await req.json();
    const items = Array.isArray(body) ? body : [body];
    const container = await getContainer("signals");

    for (const item of items) {
      const doc = { ...item, kind: "signal" };
      if (!doc.id) doc.id = `signal-${doc.ticker}-${doc.screened_at}`;
      await container.items.upsert(doc);
    }

    return NextResponse.json({ created: items.length });
  } catch (err) {
    console.error("signals POST error:", err);
    return NextResponse.json({ error: "Failed to insert signals" }, { status: 500 });
  }
}
