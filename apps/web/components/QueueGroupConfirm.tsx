"use client";

import { useEffect, useRef, useState } from "react";
import { parseFeetInches } from "@/lib/feet-inches";
import { feetLabel } from "@/lib/takeoff/wallHeight";
import type { CodeHeight, Guess } from "@/lib/takeoff/reviewQueue";

/**
 * ── ONE WALL GROUP IN THE REVIEW QUEUE, CONFIRMED FROM THE KEYBOARD ──
 *
 * The suggested type and height are already in place, each with where it came
 * from, so the common case is one key:
 *
 *   Enter  accept what is shown
 *   1–9    pick another type from the legend (the height follows it, unless typed)
 *   T      edit the height ("tall"; Enter in the box accepts). Not H: H is
 *          the Hand tool everywhere else in the workspace (Chrome's re-test)
 *   N      skip to the next item
 *
 * The keys are taken in the capture phase and stopped there, so the viewer's
 * own keys never see them while a group is on show. Nothing is claimed while somebody types in
 * another field.
 */
export function QueueGroupConfirm({
  label,
  codes,
  suggested,
  heightOf,
  missing = null,
  onAccept,
  onSkip,
}: {
  /** What the group is: `Walls · sheet A101 · 4-7/8" · 65 ft`. */
  label: string;
  /** The legend's codes, numbered 1–9 in this order. Empty for a group whose type is settled. */
  codes: readonly string[];
  /** The type shown first, or null when there is none to suggest (and none to pick). */
  suggested: Guess | null;
  /** The height to pre-fill for a type. */
  heightOf: (code: string | null) => CodeHeight | null;
  /** Why no height from the drawings can be offered (no legend read), and where to fix it. */
  missing?: { text: string; href: string; action: string } | null;
  onAccept: (code: string | null, heightFt: number | null) => void;
  onSkip: () => void;
}) {
  const [pick, setPick] = useState<Guess | null>(suggested);
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heightBox = useRef<HTMLInputElement>(null);
  const height = heightOf(pick?.code ?? null);
  const heightText = typed ?? (height === null ? "" : feetLabel(height.feet));
  const choosing = codes.length > 0;

  function accept() {
    if (choosing && pick === null) return setError("Pick a type: 1–9.");
    let feet: number | null = null;
    if (heightText.trim() !== "") {
      const parsed = parseFeetInches(heightText, { label: "Height", min: 0 });
      if (!parsed.ok || !(parsed.n > 0 && parsed.n < 100)) return setError(parsed.ok ? "A wall height is between 0 and 100 ft." : parsed.error);
      feet = parsed.n;
    }
    onAccept(pick?.code ?? null, feet);
  }
  const choose = (code: string) => {
    setError(null);
    setPick(code === suggested?.code ? suggested : { code, from: "picked by you" });
  };

  // Read through a ref, so the one listener always acts on this render.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target === heightBox.current) return; // the box's own form handles Enter
    if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
    const key = event.key;
    const digit = /^[1-9]$/.test(key) ? Number(key) : 0;
    if (key === "Enter") accept();
    else if (digit > 0 && choosing && codes[digit - 1] !== undefined) choose(codes[digit - 1]!);
    else if (key === "t" || key === "T") {
      heightBox.current?.focus();
      heightBox.current?.select();
    } else if (key === "n" || key === "N") onSkip();
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  const button = "min-h-[28px] rounded-md border border-line-card px-2 text-xs font-medium text-ink-body hover:bg-rail disabled:opacity-50";
  return (
    <span className="contents" data-takeoff="queue-group">
      <span className="font-medium">{label}</span>
      {choosing && (
        <span className="inline-flex items-center gap-1">
          <span className="text-ink-muted">Type</span>
          <span className="rounded bg-tag-brand px-1.5 py-0.5 font-semibold text-tag-brand-ink" data-takeoff="queue-type">
            {pick?.code ?? "—"}
          </span>
          <span className="text-ink-muted" data-takeoff="queue-type-from">
            {pick?.from ?? "nothing on the drawing names it: 1–9"}
          </span>
        </span>
      )}
      <form
        className="inline-flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          accept();
        }}
      >
        <span className="text-ink-muted">Height</span>
        <input
          ref={heightBox}
          inputMode="decimal"
          value={heightText}
          placeholder="none"
          aria-label="Height (T)"
          data-takeoff="queue-height"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
          }}
          className="w-16 rounded-md border border-line-card bg-surface px-1.5 py-0.5 text-xs text-ink-body"
        />
        <span className="text-ink-muted" data-takeoff="queue-height-from">
          {typed !== null ? "typed" : (height?.from ?? "none known: T to type one")}
        </span>
      </form>
      {missing !== null && (
        <span className="text-ink-muted" data-takeoff="queue-height-missing">
          {missing.text}{" "}
          <a href={missing.href} className="underline">
            {missing.action}
          </a>
        </span>
      )}
      <button type="button" className={`${button} border-brand bg-brand font-semibold text-neutral-900`} onClick={accept} data-takeoff="queue-accept">
        Accept ⏎
      </button>
      {choosing && (
        <span className="inline-flex flex-wrap items-center gap-1" data-takeoff="queue-codes">
          {codes.map((code, i) => (
            <button
              key={code}
              type="button"
              className={`${button} ${code === pick?.code ? "border-brand" : ""}`}
              onClick={() => choose(code)}
              aria-pressed={code === pick?.code}
              data-takeoff="queue-code"
            >
              {i < 9 && <span className="mr-1 text-ink-muted">{i + 1}</span>}
              {code}
            </button>
          ))}
        </span>
      )}
      <span className="text-ink-muted" data-takeoff="queue-keys">
        Enter accept{choosing ? " · 1–9 type" : ""} · T height · N skip
      </span>
      {error !== null && (
        <span role="alert" className="text-tag-rose-ink">
          {error}
        </span>
      )}
    </span>
  );
}
