import { NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { Container } from "@azure/cosmos";

async function safeContainer(name: string): Promise<Container | null> {
  try {
    return await getContainer(name);
  } catch {
    return null;
  }
}

async function safeQuery<T>(container: Container | null, query: string, parameters?: { name: string; value: string | number | boolean }[]): Promise<T[]> {
  if (!container) return [];
  try {
    const res = await container.items.query<T>({ query, parameters }).fetchAll();
    return res.resources;
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const container = await safeContainer("trades");

    const today = new Date().toISOString().slice(0, 10);

    const TRADE_FILTER = '(c.kind = "trade" OR NOT IS_DEFINED(c.kind))';
    const SIGNAL_FILTER = 'c.kind = "signal"';

    const [totalTradesRes, todayTradesRes, statusBreakdownRes, totalSignalsRes, buySignalsRes] =
      await Promise.all([
        safeQuery<number>(container, `SELECT VALUE COUNT(1) FROM c WHERE ${TRADE_FILTER}`),
        safeQuery<number>(container, `SELECT VALUE COUNT(1) FROM c WHERE ${TRADE_FILTER} AND STARTSWITH(c.timestamp, @today)`, [{ name: "@today", value: today }]),
        safeQuery<{ status: string; count: number }>(container, `SELECT c.status, COUNT(1) as count FROM c WHERE ${TRADE_FILTER} GROUP BY c.status`),
        safeQuery<number>(container, `SELECT VALUE COUNT(1) FROM c WHERE ${SIGNAL_FILTER}`),
        safeQuery<number>(container, `SELECT VALUE COUNT(1) FROM c WHERE ${SIGNAL_FILTER} AND c.rating = "BUY"`),
      ]);

    return NextResponse.json({
      totalTrades: totalTradesRes[0] ?? 0,
      todayTrades: todayTradesRes[0] ?? 0,
      statusBreakdown: statusBreakdownRes,
      totalSignals: totalSignalsRes[0] ?? 0,
      buySignals: buySignalsRes[0] ?? 0,
    });
  } catch (err) {
    console.error("stats API error:", err);
    return NextResponse.json({
      totalTrades: 0, todayTrades: 0, statusBreakdown: [],
      totalSignals: 0, buySignals: 0,
    });
  }
}
