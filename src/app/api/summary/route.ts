import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getContainer, TradeEvent, Signal, PositionState } from "@/lib/cosmos";
import portfolioTemplate from "@/assets/portfolio_template.json";
import { isLocalRequest, rejectExternal } from "@/lib/localhost-only";

/**
 * Builds today's transaction context from Cosmos, then asks the chosen LLM
 * provider to fill in the portfolio_template.json schema.
 *
 * No web grounding (per user pref) — recommendations are grounded only in
 * the bot's own observations (trades, signals, positions, failures).
 */

type Provider = "openai" | "gemini";
type BotScope = "copytrade" | "earnings-trade" | "indicator-alert-bot" | "combined";

interface SummaryRequest {
  provider: Provider;
  bot: BotScope;
  force?: boolean;  // bypass cache
}

// Default cheap/fast models. Override via env if needed.
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ── In-memory cache ──────────────────────────────────────────────────────────
// The AI calls are slow (2-10s) and cost real money / quota. Cache by
// (provider, bot) with a TTL that flexes by trading hours:
//   - 2h while the market is open (NYSE: 09:30-16:00 ET, Mon-Fri)
//   - 6h after-hours / weekends
// The cache lives in the Node process, so it survives between requests but is
// cleared on container restart — that's fine, the cache is just an optimization.
// The UI exposes a "Force refresh" path via {force:true} to bypass.

const TTL_TRADING_MS  = 2 * 60 * 60 * 1000;
const TTL_OFFHOURS_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  cached_at: number;
  ttl_ms: number;
  // The full response body that was originally returned to a caller, minus
  // the cache-status fields we'll overlay on the way out.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

// Module-scope so it survives across requests within the same Node process.
const summaryCache = new Map<string, CacheEntry>();

function cacheKey(provider: Provider, bot: BotScope): string {
  return `${provider}:${bot}`;
}

function isMarketOpenNow(): boolean {
  // NYSE regular session 09:30-16:00 America/New_York, Mon-Fri.
  // We use Intl.DateTimeFormat to read the time in ET regardless of where
  // the container is running.
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const minutesEt = hour * 60 + minute;
    const isWeekday = !["Sat", "Sun"].includes(weekday);
    return isWeekday && minutesEt >= 9 * 60 + 30 && minutesEt < 16 * 60;
  } catch {
    return false;
  }
}

function ttlForNow(): number {
  return isMarketOpenNow() ? TTL_TRADING_MS : TTL_OFFHOURS_MS;
}

const TRADE_FILTER = '(c.kind = "trade" OR NOT IS_DEFINED(c.kind))';
const SIGNAL_FILTER = 'c.kind = "signal"';
const POSITION_FILTER = 'c.kind = "position_state"';

function todayBoundsUtc(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: start.toISOString(), to: now.toISOString() };
}

async function gatherContext(bot: BotScope) {
  const container = await getContainer("trades");
  const { from } = todayBoundsUtc();

  const botCondition = (kindFilter: string) => {
    if (bot === "combined") return `${kindFilter} AND c.timestamp >= @from`;
    if (kindFilter === POSITION_FILTER) return `${kindFilter} AND c.bot = @bot`;
    return `${kindFilter} AND c.bot = @bot AND c.timestamp >= @from`;
  };

  const params = bot === "combined"
    ? [{ name: "@from", value: from }]
    : [{ name: "@from", value: from }, { name: "@bot", value: bot }];

  const positionsCondition =
    bot === "combined" ? POSITION_FILTER : `${POSITION_FILTER} AND c.bot = @bot`;
  const positionsParams = bot === "combined" ? [] : [{ name: "@bot", value: bot }];

  const [tradesRes, signalsRes, positionsRes] = await Promise.all([
    container.items
      .query<TradeEvent>({
        query: `SELECT * FROM c WHERE ${botCondition(TRADE_FILTER)} ORDER BY c.timestamp ASC`,
        parameters: params,
      })
      .fetchAll(),
    container.items
      .query<Signal>({
        query: `SELECT * FROM c WHERE ${botCondition(SIGNAL_FILTER).replace("c.timestamp", "c.screened_at")} ORDER BY c.screened_at ASC`,
        parameters: params.map((p) => p.name === "@from" ? p : p),
      })
      .fetchAll(),
    container.items
      .query<PositionState>({
        query: `SELECT * FROM c WHERE ${positionsCondition}`,
        parameters: positionsParams,
      })
      .fetchAll(),
  ]);

  const trades = tradesRes.resources;
  const signals = signalsRes.resources;
  const positions = positionsRes.resources;

  // Aggregate
  const byStatus = new Map<string, number>();
  const failures: { ticker?: string; symbol?: string; error?: string; status?: string; timestamp?: string }[] = [];
  for (const t of trades) {
    const s = t.status ?? "unknown";
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    if (s === "failed") {
      failures.push({
        ticker: t.ticker ?? t.symbol,
        error: t.error ?? "Alpaca order returned None",
        status: s,
        timestamp: t.timestamp,
      });
    }
  }

  const bySources = new Map<string, number>();
  for (const sig of signals) {
    for (const src of sig.sources ?? []) {
      bySources.set(src, (bySources.get(src) ?? 0) + 1);
    }
  }

  return { trades, signals, positions, byStatus, failures, bySources };
}

function buildPrompt(ctx: Awaited<ReturnType<typeof gatherContext>>, bot: BotScope): string {
  const today = new Date().toISOString().slice(0, 10);

  return [
    "You are an analyst summarizing one trading day for a paper-trading bot system.",
    "Bots may include: 'copytrade' (mirrors politicians' disclosed buys),",
    "'earnings-trade' (earnings + politician overlap screens), and",
    "'indicator-alert-bot' (technical rules on the watchlist, trades after email approval).",
    "",
    `Scope: ${bot === "combined" ? "BOTH bots combined" : `only the '${bot}' bot`}`,
    `Report date (UTC): ${today}`,
    "",
    "You will be given JSON with today's activity. Use ONLY that data — do not invent",
    "news, prices, or political events. If a field cannot be filled from the data, set",
    "it to an empty string or null and explain in the narrative why it's missing.",
    "",
    "Return a JSON object that matches this schema EXACTLY (no extra keys, no commentary):",
    "```json",
    JSON.stringify(portfolioTemplate, null, 2),
    "```",
    "",
    "Field guidance:",
    "- portfolio_summary.holdings — one entry per current open position. Pull current_price,",
    "  average_cost_basis, quantity from `positions`. Recommendation.action is one of",
    "  Hold / Buy / Reduce / Sell. Thesis_status is Intact / Weakening / Broken based on",
    "  how the position is performing vs. its trailing stop.",
    "- market_context.futures_outlook / political_pulse / top_news_brief — you have NO web",
    "  access, so leave these mostly empty but you may infer political_pulse from the",
    "  politicians who appear most often in today's signals.",
    "- today_summary.narrative — 3-5 sentences of plain English describing what happened",
    "  from market open to now: how many trades were submitted, watched, failed, etc.",
    "- today_summary.data_pulled_and_filtered — fill from the source counts provided.",
    "- today_summary.failures — list each failed trade with its reason.",
    "",
    "ACTIVITY DATA:",
    "```json",
    JSON.stringify({
      generated_at: new Date().toISOString(),
      bot_scope: bot,
      counts: {
        trades_today: ctx.trades.length,
        signals_today: ctx.signals.length,
        open_positions_now: ctx.positions.length,
        by_status: Object.fromEntries(ctx.byStatus),
        by_signal_source: Object.fromEntries(ctx.bySources),
      },
      failures: ctx.failures,
      open_positions: ctx.positions.map((p) => ({
        ticker: p.ticker,
        bot: p.bot,
        qty: p.qty,
        entry_price: p.entry_price,
        current_price: p.current_price,
        peak: p.peak,
        stop_level: p.stop_level,
        trail_pct: p.trail_pct,
        current_gain_pct: p.current_gain_pct,
        updated_at: p.updated_at,
      })),
      signals_sample: ctx.signals.slice(0, 25).map((s) => ({
        ticker: s.ticker,
        rating: s.rating,
        conviction: s.conviction,
        confirmed: s.confirmed,
        politicians: s.politicians,
        sources: s.sources,
        sector: s.sector,
        screened_at: s.screened_at,
        bot: s.bot,
      })),
      trades_sample: ctx.trades.slice(-25).map((t) => ({
        ticker: t.ticker ?? t.symbol,
        status: t.status,
        rating: t.rating,
        notional: t.notional,
        price: t.entry_price ?? t.price,
        politician: t.politician,
        timestamp: t.timestamp,
        bot: t.bot,
        event: t.event,
        error: t.error,
      })),
    }, null, 2),
    "```",
    "",
    "Return ONLY the JSON object. No prose, no markdown fences.",
  ].join("\n");
}

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "You always reply with valid JSON only." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  return res.choices[0]?.message?.content ?? "{}";
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });
  const res = await model.generateContent(prompt);
  return res.response.text() ?? "{}";
}

export async function POST(req: NextRequest) {
  let body: SummaryRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  const bot = body.bot;
  const force = body.force === true;

  if (!["openai", "gemini"].includes(provider)) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  if (!["copytrade", "earnings-trade", "indicator-alert-bot", "combined"].includes(bot)) {
    return NextResponse.json({ error: `Unknown bot scope: ${bot}` }, { status: 400 });
  }

  // ── Cache check ──────────────────────────────────────────────────────────
  const key = cacheKey(provider, bot);
  if (!force) {
    const hit = summaryCache.get(key);
    if (hit) {
      const age_ms = Date.now() - hit.cached_at;
      if (age_ms < hit.ttl_ms) {
        return NextResponse.json({
          ...hit.payload,
          cache: {
            hit: true,
            cached_at: new Date(hit.cached_at).toISOString(),
            age_ms,
            ttl_ms: hit.ttl_ms,
            expires_at: new Date(hit.cached_at + hit.ttl_ms).toISOString(),
            market_open: isMarketOpenNow(),
          },
        });
      }
      // Expired — drop and continue to a fresh fetch.
      summaryCache.delete(key);
    }
  }

  // Surface a clean error if the key isn't configured rather than letting the
  // SDK throw a less helpful one.
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured on the server" }, { status: 503 });
  }
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured on the server" }, { status: 503 });
  }

  try {
    const ctx = await gatherContext(bot);

    // If there is literally no activity, skip the LLM call — saves tokens
    // and gives a deterministic "nothing happened today" response.
    const isEmpty = ctx.trades.length === 0 && ctx.signals.length === 0 && ctx.positions.length === 0;
    if (isEmpty) {
      const payload = {
        provider,
        bot,
        model: provider === "openai" ? OPENAI_MODEL : GEMINI_MODEL,
        empty: true,
        result: {
          today_summary: {
            narrative: "No trading activity recorded today yet for this scope.",
            data_pulled_and_filtered: { sources: [], filter_notes: "No signals screened today." },
            failures: [],
          },
          portfolio_summary: { report_date: new Date().toISOString().slice(0, 10), holdings: [] },
          market_context: {
            futures_outlook: { sentiment_score: "Neutral", drivers: [] },
            political_pulse: { congressional_focus: "", policy_impact: "" },
            top_news_brief: [],
          },
        },
      };
      // Empty-day responses get cached too — re-running the bot doesn't
      // change the answer until a cycle fills the data.
      const ttl_ms = ttlForNow();
      summaryCache.set(key, { cached_at: Date.now(), ttl_ms, payload });
      return NextResponse.json({
        ...payload,
        cache: { hit: false, cached_at: new Date().toISOString(), age_ms: 0, ttl_ms, expires_at: new Date(Date.now() + ttl_ms).toISOString(), market_open: isMarketOpenNow() },
      });
    }

    const prompt = buildPrompt(ctx, bot);
    const raw = provider === "openai" ? await callOpenAI(prompt) : await callGemini(prompt);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Some models occasionally wrap JSON in ```json ... ``` fences despite
      // explicit instructions — strip them and retry.
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try { parsed = JSON.parse(cleaned); }
      catch { parsed = { _raw: raw }; }
    }

    const payload = {
      provider,
      bot,
      model: provider === "openai" ? OPENAI_MODEL : GEMINI_MODEL,
      counts: {
        trades_today: ctx.trades.length,
        signals_today: ctx.signals.length,
        open_positions: ctx.positions.length,
        failures: ctx.failures.length,
      },
      // Timeline for the UI chart — raw trades sorted by time. We send these
      // alongside the AI result so the UI can render the graph without a
      // second roundtrip and so it's grounded in real data, not LLM output.
      timeline: ctx.trades.map((t) => ({
        ticker: t.ticker ?? t.symbol ?? "",
        bot: t.bot ?? "unknown",
        status: t.status,
        rating: t.rating,
        politician: t.politician,
        timestamp: t.timestamp,
      })),
      result: parsed,
    };
    const ttl_ms = ttlForNow();
    summaryCache.set(key, { cached_at: Date.now(), ttl_ms, payload });
    return NextResponse.json({
      ...payload,
      cache: {
        hit: false,
        cached_at: new Date().toISOString(),
        age_ms: 0,
        ttl_ms,
        expires_at: new Date(Date.now() + ttl_ms).toISOString(),
        market_open: isMarketOpenNow(),
      },
    });
  } catch (err) {
    console.error("summary API error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Summary failed: ${msg}` }, { status: 500 });
  }
}

// GET — inspect the cache (no auth needed; no secrets exposed).
export async function GET() {
  const now = Date.now();
  const entries = Array.from(summaryCache.entries()).map(([k, v]) => {
    const age_ms = now - v.cached_at;
    return {
      key: k,
      cached_at: new Date(v.cached_at).toISOString(),
      age_ms,
      ttl_ms: v.ttl_ms,
      expired: age_ms >= v.ttl_ms,
      expires_at: new Date(v.cached_at + v.ttl_ms).toISOString(),
    };
  });
  return NextResponse.json({
    entries,
    market_open: isMarketOpenNow(),
    current_ttl_ms: ttlForNow(),
  });
}

// DELETE — purge the cache. Locked to local callers (VM-internal or browser
// via the viewer proxy) since it's a maintenance endpoint.
export async function DELETE(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  const sp = req.nextUrl.searchParams;
  const provider = sp.get("provider") as Provider | null;
  const bot = sp.get("bot") as BotScope | null;

  if (!provider && !bot) {
    const n = summaryCache.size;
    summaryCache.clear();
    return NextResponse.json({ cleared: n });
  }
  if (provider && bot) {
    const k = cacheKey(provider, bot);
    const had = summaryCache.delete(k);
    return NextResponse.json({ cleared: had ? 1 : 0, key: k });
  }
  // Partial filter — purge all matching entries.
  let removed = 0;
  for (const k of Array.from(summaryCache.keys())) {
    const [p, b] = k.split(":");
    if ((provider && p !== provider) || (bot && b !== bot)) continue;
    summaryCache.delete(k);
    removed++;
  }
  return NextResponse.json({ cleared: removed });
}
