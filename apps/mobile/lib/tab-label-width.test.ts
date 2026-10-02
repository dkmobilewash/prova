import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./strings/en";
import { ES } from "./strings/es";

/**
 * A TAB LABEL IS SHORT OR IT TRUNCATES, AND NOTHING HERE CAN MEASURE THAT.
 *
 * Build 8 shipped the Outbox tab labelled `nav.outbox` — "Waiting to send" —
 * and the bar rendered it as **"Waiting t…"**. Five tabs across a phone is
 * about 78pt each at `typography.size.xs`, and a truncated word is worse
 * than a short one: "Waiting t…" names nothing.
 *
 * It passed every check in this repo. `design-tokens`, `theme-contrast`,
 * `theme-parity` and `touch-targets` all police TOKENS, and the token here
 * was correct — the defect was the number of characters the token was asked
 * to render. happy-dom returns zeros from `getBoundingClientRect`, so no
 * test in this repo can see a width, which is the same blindness that let a
 * 1.35-point line height ship on five screens. A person on a phone found it.
 *
 * SO THIS IS A CHARACTER COUNT STANDING IN FOR A PIXEL WIDTH, AND IT SAYS
 * SO — the same trade `rowActionsCensus.test.ts` makes for delete labels. It
 * cannot prove a label fits. It can prove nobody put a sentence in the bar
 * again, which is the failure that actually happened.
 *
 * THE CEILING IS THE LONGEST LABEL THE APP ACTUALLY USES, not a round
 * number: "Settings" / "Ajustes" at 8. A round number would leave room for
 * the next offender to arrive under it. If a legitimately longer label is
 * ever needed, raise this deliberately and say which label forced it —
 * that edit is the review.
 */

const MAX_TAB_LABEL = 8;

const TAB_LAYOUT = join(__dirname, "..", "app", "(tabs)", "_layout.tsx");

/** `title: t("…")` on each Tabs.Screen, in source order. */
function tabLabelKeys(): string[] {
  const source = readFileSync(TAB_LAYOUT, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return [...source.matchAll(/title:\s*t\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
}

/** The same count reached a different way, so the two cannot drift
 * together — the bar's own `<Tabs.Screen` openings. */
function tabScreenCount(): number {
  const source = readFileSync(TAB_LAYOUT, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return [...source.matchAll(/<Tabs\.Screen\b/g)].length;
}

describe("every tab label is short enough to render whole", () => {
  const keys = tabLabelKeys();

  it("finds a label for every tab in the bar", () => {
    // SIZE, against a second expression sharing no regex with the first. A
    // `title:` pattern that stopped matching would make every assertion
    // below pass on an empty list — nothing is ever too long in a set with
    // nothing in it.
    expect(
      keys.length,
      "the tab-label extractor and the Tabs.Screen count disagree — one has drifted",
    ).toBe(tabScreenCount());
    expect(keys.length, "no tabs parsed at all — this census is vacuous").toBeGreaterThanOrEqual(5);
  });

  it("resolves every key, in both languages", () => {
    // SCOPE: a key with no string behind it would silently measure
    // `undefined`, which has no length and passes everything.
    for (const key of keys) {
      expect(EN[key as keyof typeof EN], `en has no string for ${key}`).toBeTypeOf("string");
      expect(ES[key as keyof typeof ES], `es has no string for ${key}`).toBeTypeOf("string");
    }
  });

  it("keeps every label at or under the ceiling, in both languages", () => {
    const tooLong: string[] = [];
    for (const key of keys) {
      for (const [lang, table] of [["en", EN], ["es", ES]] as const) {
        const value = table[key as keyof typeof table] as string;
        if (value.length > MAX_TAB_LABEL) tooLong.push(`${lang} ${key} = "${value}" (${value.length})`);
      }
    }
    expect(
      tooLong,
      `a tab label longer than ${MAX_TAB_LABEL} characters will truncate in the bar, as "Waiting to ` +
        `send" did on build 8 — it rendered "Waiting t…". Give the TAB its own short key and leave the ` +
        `screen's own title alone; nav.tab.outbox exists for exactly that.`,
    ).toEqual([]);
  });

  it("does not let the Outbox tab borrow the screen's title again", () => {
    // The specific regression, named. `nav.outbox` is still correct on the
    // screen, the Settings row and the section header — it is only wrong in
    // the bar, which makes it the easy mistake to repeat.
    expect(
      keys,
      "the Outbox tab is using nav.outbox again — that string is 'Waiting to send' and truncates",
    ).not.toContain("nav.outbox");
  });
});
