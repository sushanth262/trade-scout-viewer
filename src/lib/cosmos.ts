import { CosmosClient, Database, Container } from "@azure/cosmos";

let client: CosmosClient | null = null;
let database: Database | null = null;
const containerCache = new Map<string, Container>();

const DB_NAME = "tradescout";

const UNIFIED_CONTAINER = "trades";

// All three logical entities (trades, signals, log lines) live in the single
// `trades` container — Cosmos free tier caps total throughput at 1000 RU/s so
// adding more containers is not feasible. They are differentiated by `kind`
// and partitioned on the existing `/ticker` path. For log lines we set
// `ticker = <bot>` so partition cardinality stays low and ordered by bot.
const LOGICAL_TO_PHYSICAL: Record<string, string> = {
  trades:  UNIFIED_CONTAINER,
  signals: UNIFIED_CONTAINER,
  logs:    UNIFIED_CONTAINER,
  peaks:   "peaks",
};

const PARTITION_KEY: Record<string, string> = {
  [UNIFIED_CONTAINER]: "/ticker",
  peaks: "/symbol",
};

export const KIND: Record<string, string> = {
  trades:  "trade",
  signals: "signal",
  logs:    "logline",
};

function getClient(): CosmosClient {
  if (!client) {
    const endpoint = process.env.COSMOS_ENDPOINT!;
    const key = process.env.COSMOS_KEY!;
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

async function getDatabase(): Promise<Database> {
  if (!database) {
    const c = getClient();
    const { database: db } = await c.databases.createIfNotExists({ id: DB_NAME });
    database = db;
  }
  return database;
}

export async function getContainer(logicalName: string): Promise<Container> {
  const physical = LOGICAL_TO_PHYSICAL[logicalName] ?? logicalName;
  const cached = containerCache.get(physical);
  if (cached) return cached;

  const db = await getDatabase();
  const partitionKey = PARTITION_KEY[physical] ?? "/ticker";
  const { container } = await db.containers.createIfNotExists({
    id: physical,
    partitionKey: { paths: [partitionKey] },
  });
  containerCache.set(physical, container);
  return container;
}

export interface LogEntry {
  id: string;
  kind: "logline";
  ticker: string;     // partition value — set to bot name
  bot: string;        // "copytrade" | "earnings-trade" | "cosmos"
  timestamp: string;  // ISO8601
  level: string;      // INFO | WARNING | ERROR | DEBUG | ""
  line: string;       // raw log line (trimmed)
  ingestedAt: string;
}

export interface TradeEvent {
  id: string;
  trade_id: string;
  ticker: string;
  rating?: string;
  entry_price?: number;
  earnings_date?: string;
  notional?: number;
  status: string;
  order?: Record<string, unknown> | null;
  timestamp: string;
  event?: string;
  symbol?: string;
  qty?: string;
  price?: number;
  peak?: number;
  stop_level?: number;
  trail_pct?: number;
  source?: string;
  bot?: string;
  politician?: string;
  filing_date?: string;
  trade_date?: string;
  sector?: string;
  action?: string;
  asset_type?: string;
  size_label?: string;
  error?: string | null;
  note?: string;
}

export interface Signal {
  id: string;
  ticker: string;
  rating: string;
  // Optional fields — earnings-trade signals carry the full schema;
  // copytrade signals are a lighter subset, so most of these may be absent.
  earnings_date?: string;
  eps_estimate?: number | null;
  eps_growth_3yr?: number | null;
  insider_buying?: number;
  insider_sent?: string;
  politicians?: string[];
  conviction?: string;
  confirmed?: boolean;
  sources?: string[];
  avg_lag_days?: number | null;
  chambers?: string[];
  committee?: string;
  freshest_tx?: string;
  pc_ratio?: number | null;
  options_sent?: string;
  social_sent?: string;
  sent_source?: string;
  entry_price?: number;
  sector?: string;
  screened_at: string;
  bot?: string;
  rating_reason?: string;
  size_label?: string;
  filing_age_days?: number | null;
}

export interface PeakData {
  id: string;
  symbol: string;
  peak: number;
  trail_pct: number;
  updated_at: string;
}

// Live snapshot of an open position, written by monitor.py every 5 minutes.
// One row per (bot, ticker); upserted on each monitor tick. Stored in the
// `trades` container with kind="position_state" and id="position-{bot}-{ticker}".
export interface PositionState {
  id?: string;
  kind?: "position_state";
  ticker: string;
  bot: string;
  qty?: string;
  entry_price?: number | null;
  current_price?: number;
  peak?: number;
  stop_level?: number;
  trail_pct?: number;
  current_gain_pct?: number;
  qty_available?: number;
  updated_at?: string;
  source?: string;
}
