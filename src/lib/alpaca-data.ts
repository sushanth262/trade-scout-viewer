/** Server-side Alpaca REST helpers (trading + market data). */

export function hasAlpacaCredentials(): boolean {
  return !!(process.env.ALPACA_API_KEY?.trim() && process.env.ALPACA_API_SECRET?.trim());
}

export function alpacaHeaders(): HeadersInit {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) throw new Error("Missing ALPACA_API_KEY or ALPACA_API_SECRET");
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
  };
}

export async function alpacaTradingGet(path: string): Promise<unknown> {
  const base = process.env.ALPACA_BASE_URL ?? "https://paper-api.alpaca.markets";
  const res = await fetch(`${base}${path}`, { headers: alpacaHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Alpaca ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function alpacaDataGet(path: string): Promise<unknown> {
  const base = process.env.ALPACA_DATA_URL ?? "https://data.alpaca.markets";
  const res = await fetch(`${base}${path}`, { headers: alpacaHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Alpaca data ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
