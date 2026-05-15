import { NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import type { AlertState, TradeEvent } from "@/lib/cosmos";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";

const HINT =
  "Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.local to load broker orders.";

export type FlatOrder = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  order_class: string;
  order_type_label: string;
  status: string;
  qty?: string;
  filled_qty?: string;
  filled_avg_price?: string | null;
  notional?: string;
  submitted_at?: string | null;
  filled_at?: string | null;
  canceled_at?: string | null;
  bot: string;
};

/** Flatten bracket/OTO hierarchies Alpaca may nest under nested_orders or legs. */
function flattenAlpacaOrders(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  function walk(rows: Record<string, unknown>[]) {
    for (const o of rows) {
      const id = String(o?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(o);
      const nest = o.nested_orders;
      if (Array.isArray(nest) && nest.length) {
        walk(nest as Record<string, unknown>[]);
      }
      const legs = o.legs;
      if (Array.isArray(legs) && legs.length) {
        walk(legs as Record<string, unknown>[]);
      }
    }
  }
  walk(raw as Record<string, unknown>[]);
  return out.sort((a, b) => {
    const ta = String(a.updated_at ?? a.submitted_at ?? "");
    const tb = String(b.updated_at ?? b.submitted_at ?? "");
    return tb.localeCompare(ta);
  });
}

function botFromTrade(t: TradeEvent): string {
  if (typeof t.bot === "string" && t.bot) return t.bot;
  const src = t.source;
  if (src === "copytrade") return "copytrade";
  if (src === "earnings") return "earnings-trade";
  return "unknown";
}

async function fetchOrderIdToBotMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    const container = await getContainer("trades");

    const { resources: trades } = await container.items
      .query<TradeEvent>({
        query:
          'SELECT TOP 2500 * FROM c WHERE (c.kind = "trade" OR NOT IS_DEFINED(c.kind)) ORDER BY c.timestamp DESC',
      })
      .fetchAll();

    for (const t of trades || []) {
      const oid = (t.order as { id?: string } | undefined)?.id;
      if (!oid || typeof oid !== "string") continue;
      const bot = botFromTrade(t);
      if (!map.has(oid)) map.set(oid, bot);
      else if (map.get(oid) === "unknown" && bot !== "unknown") map.set(oid, bot);
    }

    const { resources: alerts } = await container.items
      .query<AlertState>({
        query:
          'SELECT c.alpaca_order_id FROM c WHERE c.kind = "alert_state" AND IS_DEFINED(c.alpaca_order_id)',
      })
      .fetchAll();

    for (const a of alerts || []) {
      const aid = String(a.alpaca_order_id ?? "").trim();
      if (!aid) continue;
      map.set(aid, "indicator-alert-bot");
    }
  } catch (e) {
    console.error("orders: cosmos order map:", e);
  }

  return map;
}

export async function GET() {
  if (!hasAlpacaCredentials()) {
    return NextResponse.json({
      configured: false,
      hint: HINT,
      orders: [] as FlatOrder[],
    });
  }

  try {
    const [rawOrders, idToBot] = await Promise.all([
      alpacaTradingGet(
        "/v2/orders?status=all&direction=desc&nested=true&limit=500",
      ) as Promise<unknown>,
      fetchOrderIdToBotMap(),
    ]);

    const flat = flattenAlpacaOrders(rawOrders);

    const orders: FlatOrder[] = flat.map((o) => {
      const id = String(o.id ?? "");
      const typeStr = String(o.type ?? "").toLowerCase() || "unknown";
      const klass = String(o.order_class ?? "simple").toLowerCase();
      const order_type_label =
        klass && klass !== "simple" ? `${typeStr} · ${klass}` : typeStr;

      return {
        id,
        symbol: String(o.symbol ?? "").toUpperCase(),
        side: String(o.side ?? "").toLowerCase(),
        type: typeStr,
        order_class: klass,
        order_type_label,
        status: String(o.status ?? "").toLowerCase(),
        qty: o.qty != null ? String(o.qty) : undefined,
        filled_qty: o.filled_qty != null ? String(o.filled_qty) : undefined,
        filled_avg_price:
          typeof o.filled_avg_price === "string" ? o.filled_avg_price : null,
        notional:
          typeof o.notional === "string"
            ? o.notional
            : o.notional != null
              ? String(o.notional)
              : undefined,
        submitted_at: typeof o.submitted_at === "string" ? o.submitted_at : null,
        filled_at: typeof o.filled_at === "string" ? o.filled_at : null,
        canceled_at: typeof o.canceled_at === "string" ? o.canceled_at : null,
        bot: idToBot.get(id) ?? "unknown",
      };
    });

    return NextResponse.json({
      configured: true,
      orders,
    });
  } catch (err) {
    console.error("orders API:", err);
    const msg = err instanceof Error ? err.message : "orders fetch failed";
    return NextResponse.json({ error: msg, configured: true, orders: [] }, { status: 502 });
  }
}
