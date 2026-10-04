import { readFileSync } from "node:fs";
import { describe as group, expect, it } from "vitest";

/**
 * EVERY UNIT THIS APP METERS IS SHOWN TO THE PERSON PAYING FOR IT.
 *
 * `AskAllowancePeriod` is the ledger. Each `*Used` column is something a
 * company's month is spent on, and each `failed*` column is something claimed
 * for a call that produced nothing. Both ledgers that write them tell a person,
 * in a sentence on screen, that "the account owner can see the month on
 * Settings → Assistant" and that a failed read is recorded there so they can ask
 * for a credit.
 *
 * ── WHY THIS FILE EXISTS ──
 *
 * For two features that sentence was FALSE. `planSheetsUsed` shipped in #551 and
 * `addendumPagesUsed` in this branch; the settings page rendered questions and
 * document pages only. So a contractor reading "you can see them on Settings →
 * Assistant" went and looked at a page that did not have the figure, twice over.
 *
 * Nothing caught it. Typecheck could not: the page compiled perfectly while
 * ignoring four fields. The suite could not: no test asserted a figure was
 * printed. It was found by a BROWSER CLICK-THROUGH, by a tester who had been
 * told a number would be on the page, went looking, and reported that it was
 * not — which is the whole argument for clicking things, and also an argument
 * for not needing a person to do it twice.
 *
 * ── HOW IT KEEPS ITSELF HONEST ──
 *
 * Both ends are derived, which every census in this repo has had to learn.
 * The COLUMNS come out of the schema rather than a list here, so a fifth unit
 * added tomorrow is covered without editing this file — a list somebody must
 * remember is the thing being guarded against. And the SIZE of that set is
 * asserted against a second count that shares no pattern with the first,
 * because a regex that matches nothing passes every downstream assertion:
 * nothing is ever missing from an empty list. That is #224's scar.
 */

const SCHEMA = new URL("../../../../packages/db/prisma/schema/ask-allowance.prisma", import.meta.url);
const PAGE = new URL("../../app/(app)/settings/assistant/page.tsx", import.meta.url);

/** `foo Int @default(0)` inside the ledger model, by name. */
function meteredColumns(text: string): string[] {
  const model = /model\s+AskAllowancePeriod\s*\{([\s\S]*?)\n\}/.exec(text);
  if (!model) return [];
  return [...model[1]!.matchAll(/^\s*(\w+)\s+Int\s+@default\(0\)/gm)].map((m) => m[1]!);
}

/**
 * The independent count, by a method sharing no pattern with the one above:
 * every line inside the model whose text contains `@default(0)`. If the parse
 * regex drifts, these two disagree and the test says so rather than quietly
 * shrinking the set it checks.
 */
function countByLine(text: string): number {
  const model = /model\s+AskAllowancePeriod\s*\{([\s\S]*?)\n\}/.exec(text);
  if (!model) return -1;
  return model[1]!
    .split("\n")
    .filter((line) => line.includes("@default(0)") && !line.trim().startsWith("//") && !line.trim().startsWith("///"))
    .length;
}

/** Comments stripped, because this page EXPLAINS itself at length and several of
 *  those comments name the very fields being looked for — #185's scar, where a
 *  census was satisfied by a comment quoting its own pattern. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

group("every metered unit reaches the screen", () => {
  const schema = readFileSync(SCHEMA, "utf8");
  const columns = meteredColumns(schema);

  it("finds the ledger's columns at all", () => {
    // Vacuous-pass guard. An empty set would make the loop below assert nothing,
    // and this file would go green having checked no units whatsoever.
    expect(columns.length, "the ledger has counter columns").toBeGreaterThanOrEqual(8);
    expect(columns).toContain("questionsUsed");
    expect(columns).toContain("planSheetsUsed");
    expect(columns).toContain("addendumPagesUsed");
  });

  it("parses as many columns as the model declares", () => {
    // The two counts share no pattern. If the parse above stops matching a
    // column shape somebody introduces, this fails naming the numbers rather
    // than letting the census check a smaller set than it appears to.
    expect(columns.length, "the parse and the line count agree").toBe(countByLine(schema));
  });

  it("prints every one of them on Settings → Assistant", () => {
    // THE ASSERTION THIS FILE IS FOR. A column the page never reads is a unit a
    // company is charged for and cannot see, while two ledgers tell them to look
    // here for it.
    const page = code(readFileSync(PAGE, "utf8"));
    const missing = columns.filter((column) => !page.includes(`allowance.${column}`));
    expect(
      missing,
      `metered but never shown on /settings/assistant: ${missing.join(", ")} — the ledgers that write ` +
        `these tell a person the account owner can see them there, so a column missing here makes that ` +
        `sentence false. Add it to the page, or stop promising it.`,
    ).toEqual([]);
  });

  it("prints a REMAINING figure for each unit too, not only what was used", () => {
    // "4 used" answers nothing on its own — what a person needs is how much is
    // left before the hard stop. Every `*Used` column has a matching `*Left` in
    // the summary, and the page must read that as well.
    const page = code(readFileSync(PAGE, "utf8"));
    const used = columns.filter((c) => c.endsWith("Used"));
    expect(used.length).toBeGreaterThanOrEqual(4);
    const missing = used
      .map((c) => `${c.slice(0, -"Used".length)}Left`)
      .filter((left) => !page.includes(`allowance.${left}`));
    expect(missing, `no remaining figure shown for: ${missing.join(", ")}`).toEqual([]);
  });
});
