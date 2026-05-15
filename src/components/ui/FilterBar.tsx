"use client";
import styles from "./FilterBar.module.css";
import SymbolSearchInput from "./SymbolSearchInput";

interface FilterOption {
  key: string;
  label: string;
  options: string[];
}

interface Props {
  filters: FilterOption[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSearch?: (term: string) => void;
  searchPlaceholder?: string;
  /** Ticker field with Alpaca + signal autocomplete (watchlist-style). */
  symbolSuggest?: boolean;
  searchValue?: string;
}

export default function FilterBar({
  filters,
  values,
  onChange,
  onSearch,
  searchPlaceholder,
  symbolSuggest,
  searchValue = "",
}: Props) {
  return (
    <div className={styles.bar}>
      {onSearch &&
        (symbolSuggest ? (
          <SymbolSearchInput
            value={searchValue}
            onChange={onSearch}
            onPick={onSearch}
            placeholder={searchPlaceholder ?? "Search ticker…"}
            className={styles.searchSuggest}
          />
        ) : (
          <input
            className={styles.search}
            placeholder={searchPlaceholder ?? "Search ticker..."}
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
          />
        ))}
      {filters.map((f) => (
        <div key={f.key} className={styles.group}>
          <label className={styles.label}>{f.label}</label>
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${!values[f.key] ? styles.active : ""}`}
              onClick={() => onChange(f.key, "")}
            >
              All
            </button>
            {f.options.map((opt) => (
              <button
                type="button"
                key={opt}
                className={`${styles.chip} ${values[f.key] === opt ? styles.active : ""}`}
                onClick={() => onChange(f.key, values[f.key] === opt ? "" : opt)}
              >
                {opt.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
