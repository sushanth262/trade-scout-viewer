import type { BotPositionRow } from "@/app/api/bot-trades-analysis/route";

export type BotPerfSummary = {
  bot: string;
  positionCount: number;
  marketValue: number;
  costBasis: number;
  unrealizedPl: number;
  returnPct: number | null;
  winners: number;
  losers: number;
  flat: number;
};

export type TickerPlRow = {
  ticker: string;
  bot: string;
  unrealizedPl: number;
  gainPct: number | null;
  marketValue: number;
};

export type BotPerformanceSnapshot = {
  overall: BotPerfSummary;
  byBot: BotPerfSummary[];
  allocation: { name: string; value: number; bot: string }[];
  plByBot: { name: string; pl: number; bot: string }[];
  topGainers: TickerPlRow[];
  topLosers: TickerPlRow[];
  exposure: { ticker: string; value: number; bot: string }[];
};

const ANALYSIS_BOTS = new Set([
  "copytrade",
  "earnings-trade",
  "indicator-alert-bot",
  "unknown",
  "alpaca-only",
]);

function parseQty(q: string | undefined): number {
  const n = parseFloat(String(q ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function rowCostBasis(p: BotPositionRow): number {
  const q = parseQty(p.qty);
  const e = p.entry_price;
  if (q > 0 && e != null && Number.isFinite(e)) return q * e;
  return 0;
}

function rowMarketValue(p: BotPositionRow): number {
  if (p.market_value != null && Number.isFinite(p.market_value)) return p.market_value;
  const q = parseQty(p.qty);
  if (q > 0 && p.current_price != null && Number.isFinite(p.current_price)) {
    return q * p.current_price;
  }
  const cb = rowCostBasis(p);
  return cb > 0 ? cb : 0;
}

function rowUnrealized(p: BotPositionRow): number {
  if (p.unrealized_pl != null && Number.isFinite(p.unrealized_pl)) return p.unrealized_pl;
  const mv = rowMarketValue(p);
  const cb = rowCostBasis(p);
  if (mv > 0 && cb > 0) return mv - cb;
  return 0;
}

function summarizeBot(bot: string, positions: BotPositionRow[]): BotPerfSummary {
  let marketValue = 0;
  let costBasis = 0;
  let unrealizedPl = 0;
  let winners = 0;
  let losers = 0;
  let flat = 0;
  let hasPl = false;

  for (const p of positions) {
    const mv = rowMarketValue(p);
    const cb = rowCostBasis(p);
    const upl = rowUnrealized(p);
    marketValue += mv;
    costBasis += cb;
    if (p.unrealized_pl != null || (mv > 0 && cb > 0)) {
      unrealizedPl += upl;
      hasPl = true;
    }
    const g = p.current_gain_pct;
    if (g == null || !Number.isFinite(g) || Math.abs(g) < 0.05) flat++;
    else if (g > 0) winners++;
    else losers++;
  }

  const returnPct =
    hasPl && costBasis > 0 ? (unrealizedPl / costBasis) * 100 : null;

  return {
    bot,
    positionCount: positions.length,
    marketValue,
    costBasis,
    unrealizedPl,
    returnPct,
    winners,
    losers,
    flat,
  };
}

function botLabel(bot: string): string {
  if (bot === "earnings-trade") return "Earnings";
  if (bot === "indicator-alert-bot") return "Alerts";
  if (bot === "alpaca-only") return "Alpaca only";
  return bot;
}

/** Aggregate open-book performance for dashboard charts. */
export function buildPerformanceSnapshot(
  groups: { bot: string; positions: BotPositionRow[] }[],
): BotPerformanceSnapshot {
  const tradingGroups = groups.filter((g) => ANALYSIS_BOTS.has(g.bot) || g.bot);
  const allPositions = tradingGroups.flatMap((g) => g.positions);

  const byBot = tradingGroups
    .filter((g) => g.bot !== "alpaca-only" || g.positions.length > 0)
    .map((g) => summarizeBot(g.bot, g.positions))
    .filter((s) => s.positionCount > 0);

  const overall = summarizeBot("all", allPositions);

  const allocation = byBot
    .filter((s) => s.marketValue > 0)
    .map((s) => ({
      name: botLabel(s.bot),
      value: Math.round(s.marketValue),
      bot: s.bot,
    }));

  const plByBot = byBot.map((s) => ({
    name: botLabel(s.bot),
    pl: Math.round(s.unrealizedPl),
    bot: s.bot,
  }));

  const tickerRows: TickerPlRow[] = [];
  for (const g of tradingGroups) {
    for (const p of g.positions) {
      const upl = rowUnrealized(p);
      tickerRows.push({
        ticker: p.ticker,
        bot: g.bot,
        unrealizedPl: upl,
        gainPct: p.current_gain_pct ?? null,
        marketValue: rowMarketValue(p),
      });
    }
  }

  const withPl = tickerRows.filter((r) => r.unrealizedPl !== 0 || r.gainPct != null);
  const topGainers = [...withPl]
    .sort((a, b) => b.unrealizedPl - a.unrealizedPl)
    .slice(0, 8);
  const topLosers = [...withPl]
    .sort((a, b) => a.unrealizedPl - b.unrealizedPl)
    .slice(0, 8);

  const exposure = [...tickerRows]
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 12)
    .map((r) => ({ ticker: r.ticker, value: Math.round(r.marketValue), bot: r.bot }));

  return {
    overall,
    byBot,
    allocation,
    plByBot,
    topGainers,
    topLosers,
    exposure,
  };
}

export function formatUsd(n: number, compact = false): string {
  if (!Number.isFinite(n)) return "—";
  if (compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export const BOT_CHART_COLORS: Record<string, string> = {
  copytrade: "#1B2B65",
  "earnings-trade": "#B45309",
  "indicator-alert-bot": "#047857",
  unknown: "#64748b",
  "alpaca-only": "#334155",
  all: "#2563eb",
};

export function colorForBot(bot: string): string {
  return BOT_CHART_COLORS[bot] ?? "#737373";
}
