"use client";

import { useEffect, useState } from "react";
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * System / Light / Dark. Light is the high-contrast palette for reading a
 * phone outdoors. The choice is per browser (localStorage); the page was
 * already painted in it by the script in app/layout.tsx, so this only reads
 * it back and writes changes.
 */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  // null until mounted: the server cannot know the stored choice, and
  // rendering a guess would mark the wrong button pressed during hydration.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => setChoice(readThemeChoice()), []);

  // While following the OS, follow it live — a phone flipping to light
  // mode at sunrise should not need a reload.
  useEffect(() => {
    if (choice !== "system" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => applyThemeChoice("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  return (
    <div role="group" aria-label="Theme" className={`flex gap-1 ${className}`}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={choice === option.value}
          onClick={() => {
            applyThemeChoice(option.value);
            setChoice(option.value);
          }}
          className={`min-h-[36px] flex-1 rounded-md border px-2 text-xs font-medium ${
            choice === option.value
              ? "border-link bg-rail-hover text-ink"
              : "border-line-card text-ink-body hover:bg-rail-hover hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
