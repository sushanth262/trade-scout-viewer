"use client";

import { useEffect, useState } from "react";
import type { AlertRule, AlertRuleType } from "@/lib/cosmos";
import {
  RULE_PRESETS,
  RULE_TYPE_LABELS,
  defaultParamsForType,
} from "@/lib/alert-rule-presets";
import styles from "./RuleBuilderForm.module.css";

type Props = {
  name: string;
  ruleType: AlertRuleType;
  timeframe: AlertRule["timeframe"];
  params: Record<string, unknown>;
  onNameChange: (v: string) => void;
  onRuleTypeChange: (t: AlertRuleType) => void;
  onTimeframeChange: (t: AlertRule["timeframe"]) => void;
  onParamsChange: (p: Record<string, unknown>) => void;
};

function numField(
  label: string,
  key: string,
  params: Record<string, unknown>,
  onChange: (p: Record<string, unknown>) => void,
  opts?: { min?: number; max?: number },
) {
  return (
    <label key={key}>
      {label}
      <input
        type="number"
        value={String(params[key] ?? "")}
        min={opts?.min}
        max={opts?.max}
        onChange={(e) => onChange({ ...params, [key]: Number(e.target.value) })}
      />
    </label>
  );
}

export default function RuleBuilderForm({
  name,
  ruleType,
  timeframe,
  params,
  onNameChange,
  onRuleTypeChange,
  onTimeframeChange,
  onParamsChange,
}: Props) {
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState(JSON.stringify(params, null, 2));

  useEffect(() => {
    setJsonText(JSON.stringify(params, null, 2));
  }, [params]);

  const applyPreset = (id: string) => {
    const p = RULE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    onRuleTypeChange(p.rule_type);
    onTimeframeChange(p.timeframe);
    onParamsChange({ ...p.params });
    onNameChange(p.defaultName);
  };

  const onTypeChange = (t: AlertRuleType) => {
    onRuleTypeChange(t);
    const d = defaultParamsForType(t);
    onParamsChange(d);
    onNameChange(RULE_PRESETS.find((p) => p.rule_type === t)?.defaultName ?? name);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.presets}>
        <span className={styles.presetsLabel}>Quick add</span>
        {RULE_PRESETS.map((p) => (
          <button key={p.id} type="button" className={styles.presetBtn} onClick={() => applyPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.form}>
        <label>
          Name
          <input value={name} onChange={(e) => onNameChange(e.target.value)} />
        </label>
        <label>
          Type
          <select value={ruleType} onChange={(e) => onTypeChange(e.target.value as AlertRuleType)}>
            {(Object.keys(RULE_TYPE_LABELS) as AlertRuleType[]).map((t) => (
              <option key={t} value={t}>
                {RULE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timeframe
          <select
            value={timeframe}
            onChange={(e) => onTimeframeChange(e.target.value as AlertRule["timeframe"])}
          >
            <option value="1D">1D</option>
            <option value="1H">1H</option>
            <option value="15Min">15Min</option>
          </select>
        </label>

        {ruleType === "ema_crossover" && (
          <>
            {numField("Fast EMA", "fast", params, onParamsChange, { min: 2, max: 500 })}
            {numField("Slow EMA", "slow", params, onParamsChange, { min: 2, max: 500 })}
            <label>
              Direction
              <select
                value={String(params.direction ?? "bullish_cross")}
                onChange={(e) => onParamsChange({ ...params, direction: e.target.value })}
              >
                <option value="bullish_cross">Bullish cross</option>
                <option value="bearish_cross">Bearish cross</option>
              </select>
            </label>
          </>
        )}

        {ruleType === "ema_price" && (
          <>
            {numField("EMA period", "period", params, onParamsChange, { min: 2, max: 500 })}
            <label>
              Cross
              <select
                value={String(params.direction ?? "above")}
                onChange={(e) => onParamsChange({ ...params, direction: e.target.value })}
              >
                <option value="above">Price crosses above EMA</option>
                <option value="below">Price crosses below EMA</option>
              </select>
            </label>
          </>
        )}

        {ruleType === "rsi_threshold" && (
          <>
            {numField("RSI period", "period", params, onParamsChange, { min: 2, max: 100 })}
            {numField("Threshold", "threshold", params, onParamsChange, { min: 1, max: 99 })}
            <label>
              Direction
              <select
                value={String(params.direction ?? "below")}
                onChange={(e) => onParamsChange({ ...params, direction: e.target.value })}
              >
                <option value="below">Crosses below (oversold)</option>
                <option value="above">Crosses above (overbought)</option>
              </select>
            </label>
          </>
        )}

        {ruleType === "macd_cross" && (
          <>
            {numField("Fast", "fast", params, onParamsChange)}
            {numField("Slow", "slow", params, onParamsChange)}
            {numField("Signal", "signal", params, onParamsChange)}
            <label>
              Direction
              <select
                value={String(params.direction ?? "bullish")}
                onChange={(e) => onParamsChange({ ...params, direction: e.target.value })}
              >
                <option value="bullish">Bullish (hist &gt; 0)</option>
                <option value="bearish">Bearish (hist &lt; 0)</option>
              </select>
            </label>
          </>
        )}

        {ruleType === "price_level" && (
          <>
            {numField("Price level", "level", params, onParamsChange)}
            <label>
              Direction
              <select
                value={String(params.direction ?? "above")}
                onChange={(e) => onParamsChange({ ...params, direction: e.target.value })}
              >
                <option value="above">Cross above</option>
                <option value="below">Cross below</option>
              </select>
            </label>
          </>
        )}
      </div>

      <button type="button" className={styles.jsonToggle} onClick={() => setShowJson((s) => !s)}>
        {showJson ? "Hide" : "Show"} advanced JSON
      </button>
      {showJson && (
        <label className={styles.jsonLabel}>
          Params (JSON)
          <textarea
            rows={4}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              try {
                onParamsChange(JSON.parse(e.target.value) as Record<string, unknown>);
              } catch {
                /* wait for valid json */
              }
            }}
          />
        </label>
      )}
    </div>
  );
}
