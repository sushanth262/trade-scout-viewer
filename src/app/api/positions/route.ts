import { NextRequest, NextResponse } from "next/server";
import { getContainer, PositionState } from "@/lib/cosmos";
import { isLocalRequest, rejectExternal } from "@/lib/localhost-only";

/**
 * Position snapshots written by monitor.py every 5 minutes.
 * Storage model:
 *   - Same `trades` container (kind = "position_state")
 *   - id  = `position-{bot}-{ticker}`  (one row per open position per bot)
 *   - PK  = ticker
 * The bot pushes a COMPLETE snapshot of all open positions on every tick.
 * POST upserts every ticker in the payload AND deletes any prior snapshot
 * for that bot whose ticker is no longer in the payload — that's how a
 * closed position disappears from the UI.
 */

const KIND_FILTER = 'c.kind = "position_state"';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const bot = sp.get("bot");
    const ticker = sp.get("ticker");

    const conditions: string[] = [KIND_FILTER];
    const params: { name: string; value: string }[] = [];

    if (bot) {
      conditions.push("c.bot = @bot");
      params.push({ name: "@bot", value: bot });
    }
    if (ticker) {
      conditions.push("c.ticker = @ticker");
      params.push({ name: "@ticker", value: ticker });
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const query = `SELECT * FROM c ${where} ORDER BY c.ticker ASC`;

    const container = await getContainer("trades");
    const { resources } = await container.items
      .query<PositionState>({ query, parameters: params })
      .fetchAll();

    return NextResponse.json({ items: resources, total: resources.length });
  } catch (err) {
    console.error("positions GET error:", err);
    return NextResponse.json({ error: "Failed to fetch positions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const body: PositionState | PositionState[] = await req.json();
    const items = Array.isArray(body) ? body : [body];
    const container = await getContainer("trades");

    // Group incoming items by bot. Anything in the payload for a bot is
    // upserted; anything NOT in the payload for that bot is treated as a
    // position that closed since the previous tick and gets deleted.
    const byBot = new Map<string, Set<string>>(); // bot -> tickers present

    for (const item of items) {
      const bot = item.bot ?? "unknown";
      const ticker = item.ticker;
      if (!ticker) continue;
      const doc = {
        ...item,
        kind: "position_state",
        id: `position-${bot}-${ticker}`,
      };
      await container.items.upsert(doc);
      if (!byBot.has(bot)) byBot.set(bot, new Set());
      byBot.get(bot)!.add(ticker);
    }

    // For every bot in the payload, find existing position_state rows that
    // were NOT in this snapshot and delete them — those positions closed.
    let pruned = 0;
    for (const [bot, presentTickers] of byBot.entries()) {
      const { resources: existing } = await container.items
        .query<{ id: string; ticker: string }>({
          query: `SELECT c.id, c.ticker FROM c WHERE ${KIND_FILTER} AND c.bot = @bot`,
          parameters: [{ name: "@bot", value: bot }],
        })
        .fetchAll();
      for (const row of existing) {
        if (!presentTickers.has(row.ticker)) {
          try {
            await container.item(row.id, row.ticker).delete();
            pruned++;
          } catch {
            // tolerate race conditions / already-deleted rows
          }
        }
      }
    }

    return NextResponse.json({ upserted: items.length, pruned });
  } catch (err) {
    console.error("positions POST error:", err);
    return NextResponse.json({ error: "Failed to upsert positions" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const sp = req.nextUrl.searchParams;
    // Delete any position_state row whose updated_at is older than N minutes
    // (default 60). Use this as a janitor in case the bot stops pushing.
    const minutes = Math.max(1, parseInt(sp.get("olderThanMinutes") ?? "60"));
    const cutoffIso = new Date(Date.now() - minutes * 60_000).toISOString();

    const container = await getContainer("trades");
    const { resources } = await container.items
      .query<{ id: string; ticker: string }>({
        query: `SELECT c.id, c.ticker FROM c WHERE ${KIND_FILTER} AND c.updated_at < @cutoff`,
        parameters: [{ name: "@cutoff", value: cutoffIso }],
      })
      .fetchAll();

    let deleted = 0;
    for (const r of resources) {
      if (!r.ticker) continue;
      try {
        await container.item(r.id, r.ticker).delete();
        deleted++;
      } catch {
        // ignore
      }
    }
    return NextResponse.json({ deleted, cutoffIso });
  } catch (err) {
    console.error("positions DELETE error:", err);
    return NextResponse.json({ error: "Failed to prune positions" }, { status: 500 });
  }
}
