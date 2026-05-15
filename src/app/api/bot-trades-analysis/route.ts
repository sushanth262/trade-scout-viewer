import { NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import type { PositionState } from "@/lib/cosmos";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";
import { buildBotAttribution } from "@/lib/bot-attribution";

const KIND_FILTER = 'c.kind = "position_state"';

function up(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function parsePlc(s: string | undefined): number | undefined {
  const u = parseFloat(s ?? "");
  if (!Number.isFinite(u)) return undefined;
  if (Math.abs(u) <= 1 && u !== 0) return u * 100;
  return u;
}

function parseNum(v: string | undefined): number | undefined {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export type BotPositionRow = {
  ticker: string;
  bot: string;
  qty?: string;
  entry_price?: number | null;
  current_price?: number;
  current_gain_pct?: number;
  unrealized_pl?: number;
  market_value?: number;
};

/**
 * Open positions grouped by bot, deduped by trade-log ownership.
 * Monitors tag every Alpaca holding under each bot; we only keep a ticker on the bot that submitted the buy.
 */
export async function GET() {
  try {
    const attribution = await buildBotAttribution();

    const container = await getContainer("trades");
    const { resources: liveRows } = await container.items
      .query<PositionState>({
        query: `SELECT * FROM c WHERE ${KIND_FILTER} ORDER BY c.updated_at DESC`,
      })
      .fetchAll();

    type AlpacaPos = {
      symbol: string;
      qty: string;
      avg_entry_price: string;
      current_price: string;
      unrealized_plpc?: string;
      market_value?: string;
      unrealized_pl?: string;
    };

    let alpacaBySym = new Map<string, AlpacaPos>();
    if (hasAlpacaCredentials()) {
      try {
        const raw = (await alpacaTradingGet("/v2/positions")) as unknown;
        if (Array.isArray(raw)) {
          for (const ap of raw as AlpacaPos[]) {
            alpacaBySym.set(up(ap.symbol), ap);
          }
        }
      } catch (e) {
        console.error("bot-trades-analysis alpaca:", e);
      }
    }

    const merged = new Map<string, BotPositionRow>();

    for (const live of liveRows || []) {
      const tick = up(live.ticker);
      if (!tick) continue;
      const rowBot = typeof live.bot === "string" && live.bot ? live.bot : "unknown";

      const owner = attribution.symbolToBot.get(tick);
      if (owner && owner !== rowBot) continue;

      const canUseAlpaca = !owner || owner === rowBot;
      const ap = canUseAlpaca ? alpacaBySym.get(tick) : undefined;
      const upl = parseNum(ap?.unrealized_pl);
      const mv = parseNum(ap?.market_value);

      merged.set(`${rowBot}|${tick}`, {
        ticker: tick,
        bot: rowBot,
        qty: live.qty,
        entry_price: live.entry_price ?? parseNum(ap?.avg_entry_price) ?? undefined,
        current_price: live.current_price ?? parseNum(ap?.current_price),
        current_gain_pct: live.current_gain_pct ?? (ap ? parsePlc(ap.unrealized_plpc) : undefined),
        unrealized_pl: ap && Number.isFinite(upl!) ? upl : undefined,
        market_value: ap && Number.isFinite(mv!) ? mv : undefined,
      });
    }

    const held = new Set([...merged.values()].map((p) => p.ticker));
    if (hasAlpacaCredentials()) {
      for (const [sym, ap] of alpacaBySym) {
        if (held.has(sym)) continue;
        if (attribution.symbolToBot.has(sym)) continue;
        merged.set(`alpaca-only|${sym}`, {
          ticker: sym,
          bot: "alpaca-only",
          qty: ap.qty,
          entry_price: parseNum(ap.avg_entry_price),
          current_price: parseNum(ap.current_price),
          current_gain_pct: parsePlc(ap.unrealized_plpc),
          unrealized_pl: parseNum(ap.unrealized_pl),
          market_value: parseNum(ap.market_value),
        });
      }
    }

    const byBot = new Map<string, BotPositionRow[]>();
    for (const p of merged.values()) {
      if (!byBot.has(p.bot)) byBot.set(p.bot, []);
      byBot.get(p.bot)!.push(p);
    }
    for (const arr of byBot.values()) {
      arr.sort((a, b) => a.ticker.localeCompare(b.ticker));
    }

    const order = [
      "copytrade",
      "earnings-trade",
      "indicator-alert-bot",
      "unknown",
      "alpaca-only",
    ];
    const groups: { bot: string; positions: BotPositionRow[] }[] = [];
    for (const b of order) {
      if (byBot.has(b)) groups.push({ bot: b, positions: byBot.get(b)! });
    }
    for (const [b, positions] of byBot) {
      if (!order.includes(b)) groups.push({ bot: b, positions });
    }

    return NextResponse.json({ groups });
  } catch (err) {
    console.error("bot-trades-analysis GET:", err);
    return NextResponse.json({ error: "Failed to load bot positions", groups: [] }, { status: 500 });
  }
}
