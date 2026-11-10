"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
 *   Z      take the next height by part of the building, where the sections
 *          print one per zone (Joplin's 12'-0" / 12'-4" / 16'-8") — a choice,
 *          since nothing on a plan says which wall is under which roof
 *   N      skip to the next item
 *   A      the type picked, on every group of the sheet nothing names (`rest`)
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
  heightOptions = () => [],
  onAccept,
  onSkip,
  rest = null,
  onAcceptRest,
  codeDetail,
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
  /** A type's heights by part of the building, each with what printed it, to pick from. */
  heightOptions?: (code: string | null) => readonly CodeHeight[];
  onAccept: (code: string | null, heightFt: number | null) => void;
  onSkip: () => void;
  /** "13 groups nothing names on A101": offers the type picked here on all of them at once. */
  rest?: string | null;
  onAcceptRest?: (code: string, heightFt: number | null) => void;
  /** What sits beside each type's number: its thickness and legend picture, for a group nothing names. */
  codeDetail?: (code: string) => ReactNode;
}) {
  const [pick, setPick] = useState<Guess | null>(suggested);
  const [typed, setTyped] = useState<string | null>(null);
  // ── THE BOX HOLDS STILL ONCE SOMEBODY IS IN IT ──
  // What it showed when it got focus (T or a tap). A pre-fill that arrives
  // later — a save landing gives the type a height — must not change the box
  // under the caret: fast-confirm's step 6 typed 9'-6" into a box that had
  // just become 10'-0", and saved "10'-0"9'-6"". Picking a type or a zone
  // clears it, so the height still follows the type picked.
  const [frozen, setFrozen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heightBox = useRef<HTMLInputElement>(null);
  // The zone picked, by its place in the type's list: picking another type starts over.
  const [zoneAt, setZoneAt] = useState<{ code: string | null; at: number } | null>(null);
  const zones = heightOptions(pick?.code ?? null);
  const zone = zoneAt !== null && zoneAt.code === (pick?.code ?? null) ? (zones[zoneAt.at] ?? null) : null;
  const height = zone ?? heightOf(pick?.code ?? null);
  const offered = height === null ? "" : feetLabel(height.feet);
  const heightText = typed ?? frozen ?? offered;
  const takeZone = (at: number) => {
    setError(null);
    setTyped(null);
    setFrozen(null);
    setZoneAt({ code: pick?.code ?? null, at });
  };
  const choosing = codes.length > 0;

  // ── A TYPE WITH NO HEIGHT IS ASKED ITS HEIGHT HERE, ONCE ──
  // Accepting it bare made the type's item a height item of its own, so the
  // count stood still for an answer (walk v3: "the count did not move"). The
  // first Enter goes to the height; a second Enter leaves it for later.
  const [askedHeight, setAskedHeight] = useState(false);
  // Which accept asked for the height: "A" (every group nothing names) or this one.
  // Enter in the height box then finishes THAT accept — it took only this group,
  // after "A" had said all of them (ELEVEN03 A3.2: 15 groups promised, 1 taken).
  const [askedForAll, setAskedForAll] = useState(false);
  function accept(all = false) {
    if (choosing && pick === null) return setError("Pick a type: 1–9.");
    if (choosing && heightText.trim() === "" && !askedHeight) {
      setAskedHeight(true);
      setAskedForAll(all);
      setError(null);
      heightBox.current?.focus();
      return;
    }
    let feet: number | null = null;
    if (heightText.trim() !== "") {
      const parsed = parseFeetInches(heightText, { label: "Height", min: 0 });
      if (!parsed.ok || !(parsed.n > 0 && parsed.n < 100)) return setError(parsed.ok ? "A wall height is between 0 and 100 ft." : parsed.error);
      feet = parsed.n;
    }
    if (all && pick !== null && onAcceptRest) onAcceptRest(pick.code, feet);
    else onAccept(pick?.code ?? null, feet);
  }
  const offersRest = rest !== null && onAcceptRest !== undefined && choosing;
  const choose = (code: string) => {
    setError(null);
    setFrozen(null);
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
    } else if ((key === "z" || key === "Z") && zones.length > 0) takeZone(zone === null ? 0 : (zoneAt!.at + 1) % zones.length);
    else if (key === "n" || key === "N") onSkip();
    else if ((key === "a" || key === "A") && offersRest) accept(true);
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
            {pick?.variant ?? pick?.code ?? "—"}
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
          accept(askedHeight && askedForAll);
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
          onFocus={() => setFrozen((was) => was ?? offered)}
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
      {zones.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1" data-takeoff="queue-zones">
          <span className="text-ink-muted">By part of the building (Z)</span>
          {zones.map((z, i) => (
            <button key={`${z.feet}:${z.from}`} type="button" title={z.from} className={`${button} ${zone !== null && zoneAt!.at === i && typed === null ? "border-brand" : ""}`} onClick={() => takeZone(i)}>
              {feetLabel(z.feet)}
            </button>
          ))}
        </span>
      )}
      <button type="button" className={`${button} border-brand bg-brand font-semibold text-neutral-900`} onClick={() => accept()} data-takeoff="queue-accept">
        Accept ⏎
      </button>
      {offersRest && (
        <button type="button" className={button} disabled={pick === null} onClick={() => accept(true)} data-takeoff="queue-accept-rest" title="Every group on this sheet that no tag, legend or library type names gets the type picked here; Undo takes them all back">
          {pick === null ? `Pick a type for all ${rest}` : `${pick.code} on all ${rest} (A)`}
        </button>
      )}
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
              {codeDetail?.(code)}
            </button>
          ))}
        </span>
      )}
      {/* Keys for a keyboard; on a touch screen every one is a button already. */}
      <span className="hidden text-ink-muted mouse:inline" data-takeoff="queue-keys">
        Enter accept{choosing ? " · 1–9 type" : ""}{offersRest ? " · A all" : ""} · T height · N skip
      </span>
      {askedHeight && pick !== null && heightText.trim() === "" && (
        <span className="text-ink-body" data-takeoff="queue-ask-height">
          {pick.code} has no height yet: type the height of every {pick.code} wall on this job, or Enter again to leave it for later
          {askedForAll && rest !== null ? ` — on all ${rest}` : ""}.
        </span>
      )}
      {error !== null && (
        <span role="alert" className="text-tag-rose-ink">
          {error}
        </span>
      )}
    </span>
  );
}
