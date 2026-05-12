const BASE = typeof window !== "undefined" ? "" : "http://localhost:3000";

export async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

export interface StatsResponse {
  totalTrades: number;
  todayTrades: number;
  statusBreakdown: { status: string; count: number }[];
  totalSignals: number;
  buySignals: number;
}
