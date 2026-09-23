"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";
const STORAGE_KEY = "agency-monitor-theme";
const EVENT_NAME = "agency-theme-change";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(EVENT_NAME, onStoreChange);
  return () => window.removeEventListener(EVENT_NAME, onStoreChange);
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark");

  function choose(next: Theme) {
    applyTheme(next);
  }

  return (
    <div
      className={
        "am-theme-toggle " + (compact ? "am-theme-toggle-compact" : "")
      }
      aria-label="Thème de l’interface"
    >
      <button
        type="button"
        aria-pressed={theme === "dark"}
        onClick={() => choose("dark")}
        className="am-theme-choice"
      >
        Dark
      </button>
      <button
        type="button"
        aria-pressed={theme === "light"}
        onClick={() => choose("light")}
        className="am-theme-choice"
      >
        Light
      </button>
    </div>
  );
}
