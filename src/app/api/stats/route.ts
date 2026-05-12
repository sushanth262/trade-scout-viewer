import { NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

export async function GET() {
  try {
    const trades = await getContainer("trades");
    const signals = await getContainer("signals");

    const today = new Date().toISOString().slice(0, 10);

    const [totalTrades, todayTrades, statusBreakdown, totalSignals, buySignals] =
      await Promise.all([
        trades.items
          .query<number>({ query: "SELECT VALUE COUNT(1) FROM c" })
          .fetchAll()
          .then((r) => r.resources[0] ?? 0),
        trades.items
          .query<number>({
            query: "SELECT VALUE COUNT(1) FROM c WHERE STARTSWITH(c.timestamp, @today)",
            parameters: [{ name: "@today", value: today }],
          })
          .fetchAll()
          .then((r) => r.resources[0] ?? 0),
        trades.items
          .query<{ status: string; count: number }>({
            query:
              "SELECT c.status, COUNT(1) as count FROM c GROUP BY c.status",
          })
          .fetchAll()
          .then((r) => r.resources),
        signals.items
          .query<number>({ query: "SELECT VALUE COUNT(1) FROM c" })
          .fetchAll()
          .then((r) => r.resources[0] ?? 0),
        signals.items
          .query<number>({
            query:
              'SELECT VALUE COUNT(1) FROM c WHERE c.rating = "BUY"',
          })
          .fetchAll()
          .then((r) => r.resources[0] ?? 0),
      ]);

    return NextResponse.json({
      totalTrades,
      todayTrades,
      statusBreakdown,
      totalSignals,
      buySignals,
    });
  } catch (err) {
    console.error("stats API error:", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
