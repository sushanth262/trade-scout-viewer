import { NextResponse } from "next/server";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";
import {
  buildBotAttribution,
  propagateOrderBots,
  resolveOrderBot,
} from "@/lib/bot-attribution";

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

export async function GET() {
  if (!hasAlpacaCredentials()) {
    return NextResponse.json({
      configured: false,
      hint: HINT,
      orders: [] as FlatOrder[],
    });
  }

  try {
    const [rawOrders, attribution] = await Promise.all([
      alpacaTradingGet(
        "/v2/orders?status=all&direction=desc&nested=true&limit=500",
      ) as Promise<unknown>,
      buildBotAttribution(),
    ]);

    const flat = flattenAlpacaOrders(rawOrders);
    propagateOrderBots(flat, attribution);

    const orders: FlatOrder[] = flat.map((o) => {
      const id = String(o.id ?? "");
      const typeStr = String(o.type ?? "").toLowerCase() || "unknown";
      const klass = String(o.order_class ?? "simple").toLowerCase();
      const order_type_label =
        klass && klass !== "simple" ? `${typeStr} · ${klass}` : typeStr;

      const bot = resolveOrderBot(o, attribution);

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
        bot,
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
