"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./SymbolSearchInput.module.css";

export type SuggestRow = { symbol: string; name?: string; source: string };

function suggestPrefix(raw: string): string {
  const part = raw.trim();
  return part.replace(/[^a-zA-Z.]/g, "").toUpperCase();
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  onPick?: (symbol: string) => void;
  placeholder?: string;
  className?: string;
};

export default function SymbolSearchInput({
  value,
  onChange,
  onPick,
  placeholder = "Search ticker…",
  className,
}: Props) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [suggestions, setSuggestions] = useState<SuggestRow[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pfx = suggestPrefix(value);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (pfx.length < 1) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    setSuggestLoading(true);
    suggestTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${basePath}/api/symbol-suggest?q=${encodeURIComponent(pfx)}`);
        const j = (await r.json()) as { items?: SuggestRow[] };
        setSuggestions(j.items ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestLoading(false);
      }
    }, 220);
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [value, basePath]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setSuggestions([]);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (sym: string) => {
    const t = sym.toUpperCase();
    onChange(t);
    onPick?.(t);
    setSuggestions([]);
  };

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${className ?? ""}`}>
      <input
        className={styles.input}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
      />
      {(suggestions.length > 0 || suggestLoading) && (
        <ul className={styles.list} role="listbox">
          {suggestLoading && <li className={styles.muted}>Loading…</li>}
          {suggestions.map((s) => (
            <li key={`${s.symbol}-${s.source}`}>
              <button type="button" className={styles.btn} onClick={() => pick(s.symbol)}>
                <span className={styles.sym}>{s.symbol}</span>
                {s.name && <span className={styles.name}>{s.name}</span>}
                <span className={styles.src}>{s.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
