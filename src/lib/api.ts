export async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => !!v)).toString()
    : "";
  const res = await fetch(`${basePath}${path}${qs}`, { cache: "no-store" });
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
