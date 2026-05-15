import { EMA, RSI, MACD } from "technicalindicators";
import type { AlertRule } from "@/lib/cosmos";
import type { Bar } from "@/lib/market-bars";
import { barChartTime } from "@/lib/market-bars";

export type ChartTrigger = {
  time: string | number;
  price: number;
  rule: string;
  direction: "bullish" | "bearish";
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function pad<T>(arr: T[], target: number, fill: T): T[] {
  const off = target - arr.length;
  if (off <= 0) return arr;
  return [...Array(off).fill(fill), ...arr] as T[];
}

export function ruleHit(
  i: number,
  closes: number[],
  emaF: (number | undefined)[],
  emaS: (number | undefined)[],
  rsi: (number | undefined)[],
  macd: { MACD?: number; signal?: number; histogram?: number }[],
  rule: AlertRule,
): "bullish" | "bearish" | null {
  const p = rule.params;
  if (rule.rule_type === "ema_crossover") {
    const dir = String(p.direction ?? "above");
    const ef = emaF[i];
    const es = emaS[i];
    const pef = i > 0 ? emaF[i - 1] : undefined;
    const pes = i > 0 ? emaS[i - 1] : undefined;
    if (ef == null || es == null || pef == null || pes == null) return null;
    if (dir === "above" || dir === "bullish_cross") {
      if (pef <= pes && ef > es) return "bullish";
      if (pef >= pes && ef < es) return "bearish";
    } else if (dir === "below" || dir === "bearish_cross") {
      if (pef >= pes && ef < es) return "bearish";
      if (pef <= pes && ef > es) return "bullish";
    }
    return null;
  }
  if (rule.rule_type === "rsi_threshold") {
    const thr = num(p.threshold) ?? 30;
    const direction = String(p.direction ?? "below");
    const rv = rsi[i];
    if (rv == null || i < 1) return null;
    const prev = rsi[i - 1];
    if (prev == null) return null;
    if (direction === "below" && prev > thr && rv <= thr) return "bullish";
    if (direction === "above" && prev < thr && rv >= thr) return "bearish";
    return null;
  }
  if (rule.rule_type === "macd_cross") {
    const direction = String(p.direction ?? "bullish");
    const cur = macd[i];
    const prev = i > 0 ? macd[i - 1] : undefined;
    if (!cur || !prev) return null;
    const ch = cur.histogram ?? (cur.MACD ?? 0) - (cur.signal ?? 0);
    const ph = prev.histogram ?? (prev.MACD ?? 0) - (prev.signal ?? 0);
    if (direction === "bullish" && ph <= 0 && ch > 0) return "bullish";
    if (direction === "bearish" && ph >= 0 && ch < 0) return "bearish";
    return null;
  }
  if (rule.rule_type === "price_level") {
    const level = num(p.level);
    const direction = String(p.direction ?? "above");
    if (!Number.isFinite(level)) return null;
    const c = closes[i];
    const pc = closes[i - 1];
    if (i < 1) return null;
    if (direction === "above" && pc <= level && c > level) return "bullish";
    if (direction === "below" && pc >= level && c < level) return "bearish";
    return null;
  }
  return null;
}

export type EmaPeriods = { fast: number; slow: number };

export function emaPeriodsFromRules(rules: AlertRule[]): EmaPeriods {
  const emaRule = rules.find((r) => r.rule_type === "ema_crossover" && r.enabled !== false);
  return {
    fast: emaRule ? num(emaRule.params.fast) || 20 : 20,
    slow: emaRule ? num(emaRule.params.slow) || 50 : 50,
  };
}

export function computeChartSeries(
  bars: Bar[],
  rules: AlertRule[],
  timeframe: string,
): {
  emaFast: { time: string | number; value: number }[];
  emaSlow: { time: string | number; value: number }[];
  priceLevels: { price: number; title: string }[];
  triggers: ChartTrigger[];
} {
  const active = rules.filter((r) => r.enabled !== false);
  const closes = bars.map((b) => b.close);
  const n = closes.length;

  const { fast, slow } = emaPeriodsFromRules(active);
  const rsiP =
    active.find((r) => r.rule_type === "rsi_threshold")?.params.period != null
      ? num(active.find((r) => r.rule_type === "rsi_threshold")?.params.period) || 14
      : 14;

  const emaF = EMA.calculate({ period: fast, values: closes });
  const emaS = EMA.calculate({ period: slow, values: closes });
  const rsi = RSI.calculate({ period: rsiP, values: closes });
  const macd = MACD.calculate({
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    values: closes,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const emaFp = pad(emaF as (number | undefined)[], n, undefined);
  const emaSp = pad(emaS as (number | undefined)[], n, undefined);
  const rsiPadded = pad(rsi as (number | undefined)[], n, undefined);
  const macdPadded = pad(
    macd as { MACD?: number; signal?: number; histogram?: number }[],
    n,
    {},
  );

  const emaFast: { time: string | number; value: number }[] = [];
  const emaSlow: { time: string | number; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = barChartTime(bars[i].date, timeframe);
    if (emaFp[i] != null) emaFast.push({ time: t, value: emaFp[i] as number });
    if (emaSp[i] != null) emaSlow.push({ time: t, value: emaSp[i] as number });
  }

  const priceLevels: { price: number; title: string }[] = [];
  for (const rule of active) {
    if (rule.rule_type !== "price_level") continue;
    const level = num(rule.params.level);
    if (Number.isFinite(level)) {
      priceLevels.push({ price: level, title: rule.name || "Level" });
    }
  }

  const maxSlow = Math.max(
    slow,
    ...active.map((r) => (r.rule_type === "ema_crossover" ? num(r.params.slow) || 50 : 0)),
  );
  const triggers: ChartTrigger[] = [];
  for (let i = Math.max(maxSlow, 30); i < n; i++) {
    for (const rule of active) {
      const hit = ruleHit(i, closes, emaFp, emaSp, rsiPadded, macdPadded, rule);
      if (hit) {
        triggers.push({
          time: barChartTime(bars[i].date, timeframe),
          price: bars[i].close,
          rule: rule.name,
          direction: hit,
        });
      }
    }
  }

  return { emaFast, emaSlow, priceLevels, triggers };
}
