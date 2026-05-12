import { CosmosClient, Database, Container } from "@azure/cosmos";

let client: CosmosClient | null = null;
let database: Database | null = null;
const containerCache = new Map<string, Container>();

const DB_NAME = "tradescout";

const UNIFIED_CONTAINER = "trades";

const LOGICAL_TO_PHYSICAL: Record<string, string> = {
  trades: UNIFIED_CONTAINER,
  signals: UNIFIED_CONTAINER,
  peaks: "peaks",
};

export const KIND: Record<string, string> = {
  trades: "trade",
  signals: "signal",
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
  const partitionKey = physical === "peaks" ? "/symbol" : "/ticker";
  const { container } = await db.containers.createIfNotExists({
    id: physical,
    partitionKey: { paths: [partitionKey] },
  });
  containerCache.set(physical, container);
  return container;
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
  earnings_date: string;
  eps_estimate: number | null;
  eps_growth_3yr: number | null;
  insider_buying: number;
  insider_sent: string;
  politicians: string[];
  conviction: string;
  confirmed: boolean;
  sources: string[];
  avg_lag_days: number | null;
  chambers: string[];
  committee: string;
  freshest_tx: string;
  pc_ratio: number | null;
  options_sent: string;
  social_sent: string;
  sent_source: string;
  entry_price: number;
  sector: string;
  screened_at: string;
}

export interface PeakData {
  id: string;
  symbol: string;
  peak: number;
  trail_pct: number;
  updated_at: string;
}
