import { NextRequest, NextResponse } from "next/server";
import { getContainer, WatchlistEntry } from "@/lib/cosmos";
import { allowViewerWrite, rejectExternal } from "@/lib/localhost-only";
import { isValidEquityTicker, normalizeTicker } from "@/lib/ticker";

function normTicker(t: string): string {
  return normalizeTicker(t);
}

export async function GET() {
  try {
    const container = await getContainer("trades");
    const query = {
      query: 'SELECT * FROM c WHERE c.kind = "watchlist" ORDER BY c.added_at DESC',
    };
    const { resources } = await container.items.query<WatchlistEntry>(query).fetchAll();
    return NextResponse.json({ items: resources });
  } catch (err) {
    console.error("watchlist GET:", err);
    return NextResponse.json({ error: "Failed to fetch watchlist" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!allowViewerWrite(req)) return rejectExternal();
  try {
    const body = (await req.json()) as { ticker: string; notes?: string; tags?: string[] };
    if (!body?.ticker) {
      return NextResponse.json({ error: "ticker required" }, { status: 400 });
    }
    const ticker = normTicker(body.ticker);
    if (!isValidEquityTicker(ticker)) {
      return NextResponse.json(
        { error: "Invalid ticker. Use a US equity symbol (e.g. AAPL or BRK.B)." },
        { status: 400 },
      );
    }
    const container = await getContainer("trades");
    const id = `watchlist-${ticker}`;
    const doc: WatchlistEntry = {
      id,
      kind: "watchlist",
      ticker,
      notes: body.notes ?? "",
      tags: body.tags ?? [],
      added_at: new Date().toISOString(),
    };
    const { resource } = await container.items.upsert(doc);
    return NextResponse.json({ item: resource });
  } catch (err) {
    console.error("watchlist POST:", err);
    return NextResponse.json({ error: "Failed to save watchlist entry" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!allowViewerWrite(req)) return rejectExternal();
  try {
    const sp = req.nextUrl.searchParams;
    const tickerRaw = sp.get("ticker");
    if (!tickerRaw) return NextResponse.json({ error: "ticker query required" }, { status: 400 });
    const ticker = normTicker(tickerRaw);
    if (!isValidEquityTicker(ticker)) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }
    const body = (await req.json()) as { notes?: string; tags?: string[] };
    const container = await getContainer("trades");
    const id = `watchlist-${ticker}`;
    let existing: WatchlistEntry;
    try {
      const { resource } = await container.item(id, ticker).read<WatchlistEntry>();
      if (!resource) throw new Error("missing");
      existing = resource;
    } catch {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    const merged: WatchlistEntry = {
      id: existing.id ?? id,
      kind: "watchlist",
      ticker: existing.ticker ?? ticker,
      added_at: existing.added_at ?? new Date().toISOString(),
      notes: body.notes !== undefined ? body.notes : existing.notes,
      tags: body.tags !== undefined ? body.tags : existing.tags,
    };
    const { resource } = await container.items.upsert(merged);
    return NextResponse.json({ item: resource });
  } catch (err) {
    console.error("watchlist PATCH:", err);
    return NextResponse.json({ error: "Failed to update watchlist" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!allowViewerWrite(req)) return rejectExternal();
  try {
    const sp = req.nextUrl.searchParams;
    const tickerRaw = sp.get("ticker");
    if (!tickerRaw) return NextResponse.json({ error: "ticker query required" }, { status: 400 });
    const ticker = normTicker(tickerRaw);
    if (!isValidEquityTicker(ticker)) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }
    const container = await getContainer("trades");
    const id = `watchlist-${ticker}`;
    await container.item(id, ticker).delete();
    return NextResponse.json({ deleted: true, ticker });
  } catch (err) {
    console.error("watchlist DELETE:", err);
    return NextResponse.json({ error: "Failed to delete watchlist entry" }, { status: 500 });
  }
}
