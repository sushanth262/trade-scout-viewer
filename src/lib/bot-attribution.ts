import { getContainer } from "@/lib/cosmos";
import type { AlertState, TradeEvent } from "@/lib/cosmos";

export function botFromTrade(t: TradeEvent): string {
  if (typeof t.bot === "string" && t.bot) return t.bot;
  const src = t.source;
  if (src === "copytrade") return "copytrade";
  if (src === "earnings") return "earnings-trade";
  return "unknown";
}

function up(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

export type BotAttribution = {
  /** Alpaca order id → bot (from Cosmos trade / alert rows). */
  orderIdToBot: Map<string, string>;
  /** Ticker → owning bot (from submitted buys; newest wins). */
  symbolToBot: Map<string, string>;
};

/**
 * Build maps used to attribute Alpaca orders and filter duplicate monitor snapshots.
 * Both copytrade and earnings monitors push every Alpaca position under their own bot tag;
 * symbolToBot picks the bot that actually submitted the buy.
 */
export async function buildBotAttribution(): Promise<BotAttribution> {
  const orderIdToBot = new Map<string, string>();
  const symbolToBot = new Map<string, string>();

  try {
    const container = await getContainer("trades");

    const { resources: trades } = await container.items
      .query<TradeEvent>({
        query:
          'SELECT TOP 3000 * FROM c WHERE (c.kind = "trade" OR NOT IS_DEFINED(c.kind)) ORDER BY c.timestamp DESC',
      })
      .fetchAll();

    for (const t of trades || []) {
      const bot = botFromTrade(t);
      const sym = up(t.ticker ?? t.symbol);
      const oid = (t.order as { id?: string } | undefined)?.id;

      if (oid && typeof oid === "string") {
        if (!orderIdToBot.has(oid)) orderIdToBot.set(oid, bot);
        else if (orderIdToBot.get(oid) === "unknown" && bot !== "unknown") orderIdToBot.set(oid, bot);
      }

      if (!sym || bot === "unknown") continue;

      const ev = (t.event ?? "").toLowerCase();
      const st = (t.status ?? "").toLowerCase();
      const isOpen =
        st === "submitted" ||
        st === "filled" ||
        st === "open" ||
        (!ev && st !== "stop_triggered" && st !== "closed" && st !== "canceled");

      if (isOpen && !symbolToBot.has(sym)) {
        symbolToBot.set(sym, bot);
      }
    }

    const { resources: alerts } = await container.items
      .query<AlertState>({
        query:
          'SELECT c.alpaca_order_id, c.ticker FROM c WHERE c.kind = "alert_state" AND IS_DEFINED(c.alpaca_order_id)',
      })
      .fetchAll();

    for (const a of alerts || []) {
      const aid = String(a.alpaca_order_id ?? "").trim();
      if (!aid) continue;
      orderIdToBot.set(aid, "indicator-alert-bot");
      const sym = up(a.ticker);
      if (sym && !symbolToBot.has(sym)) symbolToBot.set(sym, "indicator-alert-bot");
    }
  } catch (e) {
    console.error("bot-attribution:", e);
  }

  return { orderIdToBot, symbolToBot };
}

/** Resolve bot for a flat Alpaca order row using id, parent, and symbol fallbacks. */
export function resolveOrderBot(
  o: Record<string, unknown>,
  maps: BotAttribution,
): string {
  const id = String(o.id ?? "");
  if (id && maps.orderIdToBot.has(id)) {
    return maps.orderIdToBot.get(id)!;
  }

  const parentId = String(o.parent_order_id ?? o.parent_id ?? "").trim();
  if (parentId && maps.orderIdToBot.has(parentId)) {
    return maps.orderIdToBot.get(parentId)!;
  }

  const sym = up(String(o.symbol ?? ""));
  if (sym && maps.symbolToBot.has(sym)) {
    return maps.symbolToBot.get(sym)!;
  }

  return "unknown";
}

/** After flattening, propagate bot from parents to child legs (OTO trailing stops). */
export function propagateOrderBots(
  orders: Record<string, unknown>[],
  maps: BotAttribution,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of orders) {
      const id = String(o.id ?? "");
      if (!id) continue;
      if (maps.orderIdToBot.has(id) && maps.orderIdToBot.get(id) !== "unknown") continue;

      const bot = resolveOrderBot(o, maps);
      if (bot !== "unknown") {
        maps.orderIdToBot.set(id, bot);
        changed = true;
        continue;
      }

      const parentId = String(o.parent_order_id ?? o.parent_id ?? "").trim();
      if (parentId && maps.orderIdToBot.has(parentId)) {
        const pb = maps.orderIdToBot.get(parentId)!;
        if (pb !== "unknown") {
          maps.orderIdToBot.set(id, pb);
          changed = true;
        }
      }
    }
  }
}
