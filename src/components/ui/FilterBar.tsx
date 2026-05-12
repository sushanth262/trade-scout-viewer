"use client";
import { useState } from "react";
import styles from "./FilterBar.module.css";

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
}

export default function FilterBar({ filters, values, onChange, onSearch, searchPlaceholder }: Props) {
  const [search, setSearch] = useState("");

  return (
    <div className={styles.bar}>
      {onSearch && (
        <input
          className={styles.search}
          placeholder={searchPlaceholder ?? "Search ticker..."}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            onSearch(e.target.value);
          }}
        />
      )}
      {filters.map((f) => (
        <div key={f.key} className={styles.group}>
          <label className={styles.label}>{f.label}</label>
          <div className={styles.chips}>
            <button
              className={`${styles.chip} ${!values[f.key] ? styles.active : ""}`}
              onClick={() => onChange(f.key, "")}
            >
              All
            </button>
            {f.options.map((opt) => (
              <button
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
