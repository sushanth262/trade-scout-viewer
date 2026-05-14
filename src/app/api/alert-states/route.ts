import { NextRequest, NextResponse } from "next/server";
import { getContainer, AlertState } from "@/lib/cosmos";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const ticker = sp.get("ticker");
    const status = sp.get("status");
    const limit = Math.min(parseInt(sp.get("limit") ?? "200"), 500);

    const conditions = ['c.kind = "alert_state"'];
    const params: { name: string; value: string }[] = [];
    if (ticker) {
      conditions.push("c.ticker = @ticker");
      params.push({ name: "@ticker", value: ticker.toUpperCase() });
    }
    if (status) {
      conditions.push("c.status = @status");
      params.push({ name: "@status", value: status });
    }
    const query = `SELECT * FROM c WHERE ${conditions.join(" AND ")} ORDER BY c.fired_at DESC OFFSET 0 LIMIT ${limit}`;
    const container = await getContainer("trades");
    const { resources } = await container.items
      .query<AlertState>({ query, parameters: params })
      .fetchAll();
    return NextResponse.json({ items: resources });
  } catch (err) {
    console.error("alert-states GET:", err);
    return NextResponse.json({ error: "Failed to list alert states" }, { status: 500 });
  }
}
