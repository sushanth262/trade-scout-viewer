import { NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

export async function GET() {
  try {
    const trades = await getContainer("trades");
    const signals = await getContainer("signals");

    const today = new Date().toISOString().slice(0, 10);

    const safeQuery = async <T>(container: Awaited<ReturnType<typeof getContainer>>, query: string, parameters?: { name: string; value: string | number | boolean }[]): Promise<T[]> => {
      try {
        const res = await container.items.query<T>({ query, parameters }).fetchAll();
        return res.resources;
      } catch {
        return [];
      }
    };

    const [totalTradesRes, todayTradesRes, statusBreakdownRes, totalSignalsRes, buySignalsRes] =
      await Promise.all([
        safeQuery<number>(trades, "SELECT VALUE COUNT(1) FROM c"),
        safeQuery<number>(trades, "SELECT VALUE COUNT(1) FROM c WHERE STARTSWITH(c.timestamp, @today)", [{ name: "@today", value: today }]),
        safeQuery<{ status: string; count: number }>(trades, "SELECT c.status, COUNT(1) as count FROM c GROUP BY c.status"),
        safeQuery<number>(signals, "SELECT VALUE COUNT(1) FROM c"),
        safeQuery<number>(signals, 'SELECT VALUE COUNT(1) FROM c WHERE c.rating = "BUY"'),
      ]);

    const totalTrades = totalTradesRes[0] ?? 0;
    const todayTrades = todayTradesRes[0] ?? 0;
    const statusBreakdown = statusBreakdownRes;
    const totalSignals = totalSignalsRes[0] ?? 0;
    const buySignals = buySignalsRes[0] ?? 0;

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
