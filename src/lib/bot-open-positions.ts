import { fetchApi, PaginatedResponse } from "@/lib/api";
import type { PositionState } from "@/lib/cosmos";

export type ExchangeOpen = {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_plpc?: string;
  market_value?: string;
  unrealized_pl?: string;
};

export type ExchangePosRes = {
  configured?: boolean;
  open?: ExchangeOpen[];
};

export type EnrichedBotPosition = {
  ticker: string;
  bot?: string;
  qty?: string;
  entry_price?: number | null;
  current_price?: number;
  current_gain_pct?: number;
  unrealized_pl?: number;
  market_value?: number;
};

const BOTS_SORT_ORDER = [
  "copytrade",
  "earnings-trade",
  "indicator-alert-bot",
  "unknown",
  "alpaca-only",
] as const;

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

/** Merge Cosmos position snapshots with live Alpaca P&L for open rows. */
export async function fetchOpenPositionsByBot(basePath: string): Promise<Map<string, EnrichedBotPosition[]>> {
  let exRes: ExchangePosRes = {};
  try {
    const r = await fetch(`${basePath}/api/alpaca/exchange-positions`);
    exRes = (await r.json()) as ExchangePosRes;
  } catch {
    exRes = {};
  }

  const alpacaBySym = new Map<string, ExchangeOpen>();
  if (exRes.configured && Array.isArray(exRes.open)) {
    for (const ap of exRes.open) {
      alpacaBySym.set(up(ap.symbol), ap);
    }
  }

  let liveRows: PositionState[] = [];
  try {
    const live = await fetchApi<PaginatedResponse<PositionState>>("/api/positions");
    liveRows = live.items ?? [];
  } catch {
    liveRows = [];
  }

  const merged = new Map<string, EnrichedBotPosition>();

  for (const live of liveRows) {
    const tick = up(live.ticker);
    if (!tick) continue;
    const bot = typeof live.bot === "string" && live.bot ? live.bot : "unknown";
    const ap = alpacaBySym.get(tick);
    const upl = parseNum(ap?.unrealized_pl);
    const mv = parseNum(ap?.market_value);

    merged.set(`${bot}|${tick}`, {
      ticker: tick,
      bot,
      qty: live.qty,
      entry_price: live.entry_price ?? parseNum(ap?.avg_entry_price) ?? undefined,
      current_price: live.current_price ?? parseNum(ap?.current_price),
      current_gain_pct: live.current_gain_pct ?? parsePlc(ap?.unrealized_plpc),
      unrealized_pl: Number.isFinite(upl!) ? upl : undefined,
      market_value: Number.isFinite(mv!) ? mv : undefined,
    });
  }

  const heldSyms = new Set([...merged.values()].map((p) => p.ticker));

  if (exRes.configured && Array.isArray(exRes.open)) {
    for (const ap of exRes.open) {
      const sym = up(ap.symbol);
      if (!sym || heldSyms.has(sym)) continue;
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

  const byBot = new Map<string, EnrichedBotPosition[]>();
  for (const p of merged.values()) {
    const b = p.bot ?? "unknown";
    if (!byBot.has(b)) byBot.set(b, []);
    byBot.get(b)!.push(p);
  }
  for (const arr of byBot.values()) {
    arr.sort((a, x) => a.ticker.localeCompare(x.ticker));
  }

  const sorted = new Map<string, EnrichedBotPosition[]>();
  for (const b of BOTS_SORT_ORDER) {
    if (byBot.has(b)) sorted.set(b, byBot.get(b)!);
  }
  for (const [b, arr] of byBot) {
    if (!sorted.has(b)) sorted.set(b, arr);
  }
  return sorted;
}
