import { NextRequest, NextResponse } from "next/server";
import { getContainer, AlertRule } from "@/lib/cosmos";
import { isLocalRequest, rejectExternal } from "@/lib/localhost-only";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get("ticker");
    const container = await getContainer("trades");
    const conditions = ['c.kind = "alert_rule"'];
    const params: { name: string; value: string }[] = [];
    if (ticker) {
      conditions.push("c.ticker = @ticker");
      params.push({ name: "@ticker", value: ticker.toUpperCase() });
    }
    const query = `SELECT * FROM c WHERE ${conditions.join(" AND ")} ORDER BY c.created_at DESC`;
    const { resources } = await container.items
      .query<AlertRule>({ query, parameters: params })
      .fetchAll();
    return NextResponse.json({ items: resources });
  } catch (err) {
    console.error("alert-rules GET:", err);
    return NextResponse.json({ error: "Failed to list rules" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const body = (await req.json()) as Partial<AlertRule>;
    if (!body.ticker || !body.name || !body.rule_type || !body.timeframe) {
      return NextResponse.json(
        { error: "ticker, name, rule_type, timeframe required" },
        { status: 400 },
      );
    }
    const ticker = body.ticker.toUpperCase();
    const id = `rule-${ticker}-${randomUUID()}`;
    const doc: AlertRule = {
      id,
      kind: "alert_rule",
      ticker,
      name: body.name,
      rule_type: body.rule_type as AlertRule["rule_type"],
      params: (body.params as Record<string, unknown>) ?? {},
      timeframe: body.timeframe as AlertRule["timeframe"],
      enabled: body.enabled !== false,
      created_at: new Date().toISOString(),
    };
    const container = await getContainer("trades");
    const { resource } = await container.items.upsert(doc);
    return NextResponse.json({ item: resource });
  } catch (err) {
    console.error("alert-rules POST:", err);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const patch = (await req.json()) as { enabled?: boolean };
    const container = await getContainer("trades");
    const q = {
      query: 'SELECT * FROM c WHERE c.kind = "alert_rule" AND c.id = @id',
      parameters: [{ name: "@id", value: id }],
    };
    const { resources } = await container.items.query<AlertRule>(q).fetchAll();
    const existing = resources[0];
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const merged: AlertRule = {
      ...existing,
      enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
    };
    const { resource } = await container.items.upsert(merged);
    return NextResponse.json({ item: resource });
  } catch (err) {
    console.error("alert-rules PATCH:", err);
    return NextResponse.json({ error: "Failed to patch rule" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const container = await getContainer("trades");
    const q = {
      query: 'SELECT c.id, c.ticker FROM c WHERE c.kind = "alert_rule" AND c.id = @id',
      parameters: [{ name: "@id", value: id }],
    };
    const { resources } = await container.items.query<{ id: string; ticker: string }>(q).fetchAll();
    const row = resources[0];
    if (!row?.ticker) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await container.item(row.id, row.ticker).delete();
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("alert-rules DELETE:", err);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
