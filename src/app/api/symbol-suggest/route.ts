import { NextRequest, NextResponse } from "next/server";
import { getContainer, Signal } from "@/lib/cosmos";
import { alpacaTradingGet, hasAlpacaCredentials } from "@/lib/alpaca-data";
import { isValidEquityTicker, normalizeTicker } from "@/lib/ticker";

type Row = { symbol: string; name?: string; source: "alpaca" | "cosmos" };

type CachedAsset = { symbol: string; name?: string };

let alpacaAssetsCache: CachedAsset[] | null = null;
let alpacaAssetsCacheAt = 0;
const ALPACA_ASSETS_TTL_MS = 6 * 60 * 60 * 1000;

async function loadAlpacaTradableSymbols(): Promise<CachedAsset[]> {
  const now = Date.now();
  if (alpacaAssetsCache && now - alpacaAssetsCacheAt < ALPACA_ASSETS_TTL_MS) {
    return alpacaAssetsCache;
  }
  if (!hasAlpacaCredentials()) return [];
  const raw = (await alpacaTradingGet("/v2/assets?status=active&asset_class=us_equity")) as {
    symbol?: string;
    tradable?: boolean;
    name?: string;
  }[];
  const list = (Array.isArray(raw) ? raw : [])
    .filter((a) => a.tradable !== false && a.symbol && isValidEquityTicker(a.symbol))
    .map((a) => ({ symbol: normalizeTicker(a.symbol!), name: a.name }));
  alpacaAssetsCache = list;
  alpacaAssetsCacheAt = now;
  return list;
}

function filterAlpacaPrefix(assets: CachedAsset[], prefix: string, limit: number): Row[] {
  const p = prefix.toUpperCase();
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const a of assets) {
    if (!a.symbol.startsWith(p)) continue;
    if (seen.has(a.symbol)) continue;
    seen.add(a.symbol);
    out.push({ symbol: a.symbol, name: a.name, source: "alpaca" });
    if (out.length >= limit) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const q = normalizeTicker(raw).replace(/[^A-Z.]/g, "");
  if (q.length < 1 || q.length > 8) {
    return NextResponse.json({ items: [] as Row[] });
  }

  const limit = 15;
  const rows: Row[] = [];
  const seen = new Set<string>();

  const push = (r: Row) => {
    if (seen.has(r.symbol)) return;
    seen.add(r.symbol);
    rows.push(r);
  };

  try {
    const assets = await loadAlpacaTradableSymbols();
    for (const r of filterAlpacaPrefix(assets, q, 12)) push(r);
  } catch (e) {
    console.error("symbol-suggest alpaca:", e);
  }

  try {
    const container = await getContainer("signals");
    const cq = {
      query: 'SELECT * FROM c WHERE c.kind = "signal" AND STARTSWITH(UPPER(c.ticker), @pfx)',
      parameters: [{ name: "@pfx", value: q }],
    };
    const { resources } = await container.items.query<Signal>(cq).fetchAll();
    for (const s of resources) {
      const sym = normalizeTicker(s.ticker);
      if (!isValidEquityTicker(sym) || !sym.startsWith(q)) continue;
      push({ symbol: sym, source: "cosmos" });
      if (rows.length >= limit) break;
    }
  } catch (e) {
    console.error("symbol-suggest cosmos:", e);
  }

  return NextResponse.json({ items: rows.slice(0, limit) });
}
