import type { AlertRule, AlertRuleType } from "@/lib/cosmos";

export type RulePreset = {
  id: string;
  label: string;
  rule_type: AlertRuleType;
  params: Record<string, unknown>;
  timeframe: AlertRule["timeframe"];
  defaultName: string;
};

export const RULE_PRESETS: RulePreset[] = [
  {
    id: "ema-20-50-bull",
    label: "EMA 20/50 bullish cross",
    rule_type: "ema_crossover",
    params: { fast: 20, slow: 50, direction: "bullish_cross" },
    timeframe: "1D",
    defaultName: "EMA 20/50 bull",
  },
  {
    id: "ema-20-50-bear",
    label: "EMA 20/50 bearish cross",
    rule_type: "ema_crossover",
    params: { fast: 20, slow: 50, direction: "bearish_cross" },
    timeframe: "1D",
    defaultName: "EMA 20/50 bear",
  },
  {
    id: "ema-200-above",
    label: "Price above EMA 200",
    rule_type: "ema_price",
    params: { period: 200, direction: "above" },
    timeframe: "1D",
    defaultName: "Above EMA 200",
  },
  {
    id: "ema-200-below",
    label: "Price below EMA 200",
    rule_type: "ema_price",
    params: { period: 200, direction: "below" },
    timeframe: "1D",
    defaultName: "Below EMA 200",
  },
  {
    id: "rsi-30",
    label: "RSI crosses below 30 (oversold)",
    rule_type: "rsi_threshold",
    params: { period: 14, threshold: 30, direction: "below" },
    timeframe: "1D",
    defaultName: "RSI oversold",
  },
  {
    id: "rsi-70",
    label: "RSI crosses above 70 (overbought)",
    rule_type: "rsi_threshold",
    params: { period: 14, threshold: 70, direction: "above" },
    timeframe: "1D",
    defaultName: "RSI overbought",
  },
  {
    id: "macd-bull",
    label: "MACD histogram bullish cross",
    rule_type: "macd_cross",
    params: { fast: 12, slow: 26, signal: 9, direction: "bullish" },
    timeframe: "1D",
    defaultName: "MACD bull",
  },
  {
    id: "macd-bear",
    label: "MACD histogram bearish cross",
    rule_type: "macd_cross",
    params: { fast: 12, slow: 26, signal: 9, direction: "bearish" },
    timeframe: "1D",
    defaultName: "MACD bear",
  },
];

export const RULE_TYPE_LABELS: Record<AlertRuleType, string> = {
  ema_crossover: "EMA crossover (fast/slow)",
  ema_price: "Price vs EMA (e.g. 200)",
  rsi_threshold: "RSI threshold",
  macd_cross: "MACD histogram cross",
  price_level: "Fixed price level",
};

export function defaultParamsForType(ruleType: AlertRuleType): Record<string, unknown> {
  const preset = RULE_PRESETS.find((p) => p.rule_type === ruleType);
  if (preset) return { ...preset.params };
  switch (ruleType) {
    case "ema_crossover":
      return { fast: 20, slow: 50, direction: "bullish_cross" };
    case "ema_price":
      return { period: 200, direction: "above" };
    case "rsi_threshold":
      return { period: 14, threshold: 30, direction: "below" };
    case "macd_cross":
      return { fast: 12, slow: 26, signal: 9, direction: "bullish" };
    case "price_level":
      return { level: 100, direction: "above" };
    default:
      return {};
  }
}
