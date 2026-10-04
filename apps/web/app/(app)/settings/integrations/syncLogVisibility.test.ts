import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE ACTIVITY LOG IS NOT THE SANDBOX'S.
 *
 * Nine providers write to `IntegrationSyncLog` — twenty call sites across the
 * DocuSign, Bluebeam, Procore, ACC, Jobber, CompanyCam and QuickBooks paths.
 * Every one of those rows was invisible, because the only thing that rendered
 * the list sat inside the page's `impl.kind === "builtin"` branch, which is the
 * Sandbox card and nothing else.
 *
 * The data was never the problem: the page's select has no provider filter and
 * has always loaded `syncLogs` for every connection. Only the render was gated.
 * So the defect was the shape CLAUDE.md names, arriving one layer out from
 * where that file usually finds it — not a function nothing calls, but a TABLE
 * NOTHING RENDERS. And the row it hid best was the FAILURE one written when a
 * credential dies, which is the single piece of evidence an owner wants when an
 * integration stops working.
 *
 * WHAT THIS ASSERTS, and why it is indentation rather than a parser. The page's
 * CARD-LEVEL per-kind blocks are siblings at one depth inside the card's JSX.
 * Nesting the log back under any of them necessarily indents it further, because
 * this repo formats with prettier and lint enforces it. So the check is: the
 * activity log opens at that same outermost depth, not deeper — a faithful proxy
 * for "it is not inside one of them", since a block that encloses it cannot
 * satisfy it.
 *
 * The depth is read off the blocks themselves rather than written down, so
 * reformatting moves both together and this test follows instead of failing for
 * the wrong reason. The first version of this test asserted that EVERY
 * `impl.kind` match shared one depth; it does not, because several are nested
 * inside the status-pill JSX at columns 12 and 14. That control failing is what
 * found the flaw, and it is fixed here rather than loosened: the reference is
 * the OUTERMOST depth, and a minimum number of blocks must sit at it before it
 * counts as a real sibling level.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than tidy: the
 * comment this change left at the render site explains the fix and says the word
 * `builtin` three times. A raw scan would read those as code and could conclude
 * the opposite of the truth. Same shape as #185, where a comment quoting a
 * census's own pattern disarmed it.
 */

const PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

/** Comments out, strings kept — quote- and template-aware so a `//` inside a
 *  className or a URL never eats the rest of a line. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      out += (end === -1 ? text.slice(i) : text.slice(i, end + 2)).replace(/[^\n]/g, "");
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        i += 1;
      }
      out += text[i] ?? "";
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const code = stripComments(readFileSync(PAGE, "utf8"));
const lines = code.split("\n");

const indentOf = (line: string) => (line.match(/^ */) ?? [""])[0].length;

describe("the integration activity log is visible to every provider", () => {
  /** The per-kind sibling blocks, which define the depth the log must sit at. */
  const kindBlocks = lines
    .map((line, n) => ({ line, n }))
    .filter(({ line }) => /^\s*\{impl\.kind === /.test(line));

  const logSites = lines
    .map((line, n) => ({ line, n }))
    .filter(({ line }) => /syncLogs\.length > 0/.test(line));

  it("found the blocks it reasons about", () => {
    /* SCOPE AND SIZE FIRST. A pattern that matched nothing would make every
     * assertion below vacuously true: nothing is ever nested wrongly in an
     * empty set. */
    expect(
      kindBlocks.length,
      "no `{impl.kind === …}` blocks were found — this page was restructured and " +
        "this test is now reasoning about nothing",
    ).toBeGreaterThanOrEqual(8);

    expect(
      logSites.length,
      "expected exactly one place that renders the activity log; a second one " +
        "means the list was duplicated per kind rather than shared",
    ).toBe(1);

    /* Enough blocks must share the outermost depth for it to be a real sibling
     * level rather than one stray match. The deeper matches are the per-kind
     * ternaries inside the status pill and are not what this test is about. */
    const outermost = Math.min(...kindBlocks.map(({ line }) => indentOf(line)));
    const atOutermost = kindBlocks.filter(({ line }) => indentOf(line) === outermost);
    expect(
      atOutermost.length,
      `only ${atOutermost.length} \`{impl.kind === …}\` block(s) sit at the outermost ` +
        `depth (${outermost}), so that is not a sibling level and this test cannot ` +
        "use it as the reference",
    ).toBeGreaterThanOrEqual(6);
  });

  it("renders the log at sibling depth, not nested inside one provider's branch", () => {
    const siblingDepth = Math.min(...kindBlocks.map(({ line }) => indentOf(line)));
    const site = logSites[0];

    expect(
      indentOf(site.line),
      `The activity log opens at column ${indentOf(site.line)} but the per-kind ` +
        `blocks open at ${siblingDepth}, so it is nested inside one of them. That is ` +
        "how it came to be visible only on the Sandbox card while nine providers " +
        "wrote rows nobody could read — including the FAILURE row written when a " +
        "credential dies.",
    ).toBe(siblingDepth);
  });

  it("gates the log on having a connection, never on which provider it is", () => {
    const site = logSites[0];
    expect(
      site.line,
      "the activity log's own condition names a provider kind, which re-creates " +
        "the defect in a new place",
    ).not.toMatch(/impl\.kind/);
    expect(
      site.line,
      "the log should render whenever a connection has history to show",
    ).toMatch(/connection/);
  });

  it("does not hide the history exactly when it is most wanted", () => {
    /* Deliberately NOT gated on `isConnected`. An owner reaches for this list
     * when a connection has just gone NEEDS_REAUTH or been disconnected — the
     * card's status pill says whether it is live, this says what happened to
     * it. Gating on connected would blank it at the only moment it earns its
     * place. */
    expect(
      logSites[0].line,
      "the activity log is gated on `isConnected`, so a connection that just " +
        "failed shows no history — which is the moment the history matters most",
    ).not.toMatch(/isConnected/);
  });
});
