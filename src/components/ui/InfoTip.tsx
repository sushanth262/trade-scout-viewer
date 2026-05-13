"use client";
import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import styles from "./InfoTip.module.css";

interface Props {
  text: string;
  // Optional override; useful when the icon-only ? doesn't fit visually.
  label?: React.ReactNode;
  size?: number;
}

/**
 * Hover (or click on mobile) a small "?" icon to read a short layman
 * description of the metric. Keyboard-accessible: Tab to focus, Esc to close.
 */
export default function InfoTip({ text, label, size = 13 }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={styles.wrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.btn}
        aria-label="More info"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {label ?? <HelpCircle size={size} aria-hidden="true" />}
      </button>
      {open && (
        <span role="tooltip" className={styles.bubble}>
          {text}
        </span>
      )}
    </span>
  );
}
