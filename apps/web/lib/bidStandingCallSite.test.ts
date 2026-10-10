import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PIPELINE PAGE IS A SERVER COMPONENT WITH DATABASE READS IN IT, so it
 * cannot be rendered here and this is a census standing in for a browser. It
 * says what it can see and what it cannot.
 *
 * What it can see: that the misleading count is gone and the standings are
 * rendered. What it cannot: whether they are legible, or whether anybody
 * notices them — `/pipeline` is in the click-list for that.
 */

const PAGE = resolve(process.cwd(), "app/(app)/pipeline/page.tsx");

/**
 * The page with comments stripped, and it is load-bearing rather than tidy.
 *
 * The page NAMES the old expression in prose, explaining why it is gone — so
 * the first version of this census failed on its own documentation. That is
 * #185's scar (`addendumWriteCensus.test.ts` strips comments for the same
 * reason) arriving from the opposite direction: there it was a comment
 * DISARMING a census, here a comment TRIPPING one. Both are a census reading
 * prose as code.
 */
const source = () =>
  readFileSync(PAGE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the pipeline page's standing lines", () => {
  it("NO LONGER COUNTS EVERY LIVE BID PAST ITS DATE AS A PROBLEM", () => {
    // `overdue` is `dueDate < today` with no status in it, so this counted
    // every bid submitted on time and waiting on a GC. A desk with ten bids
    // out for award read "10 past the date they asked for" in red with
    // nothing wrong — and the bid that was never sent was hiding in it.
    //
    // `isOverdue` itself is NOT wrong: `GcRecord.overdue` documents itself as
    // "Outstanding AND past the date the GC asked for", which is what it
    // computes, and ranking GCs by it is a fair question about a GC. The
    // defect was this page reading it as "something is wrong here".
    const text = source();
    expect(text).not.toContain("live.filter((b) => b.overdue)");
    expect(text).not.toContain("past the date they asked for");
  });

  it("renders a line per thing that wants doing", () => {
    const text = source();
    expect(text).toContain("bidStandings(live, today)");
    expect(text).toContain("standingLines(standings)");
    expect(text).toContain('data-pipeline="standings"');
    // GATED ON THE LINES THEMSELVES, not on something that can be switched
    // off. Found by mutation: replacing the gate with `false &&` left the
    // markup in the file and this census green.
    //
    // This is as far as a census reaches. It cannot tell that the list
    // RENDERS — the page is a server component with database reads and
    // nothing here can run it — only that the markup is not behind a gate
    // somebody has turned off. `/pipeline` is in the click-list for the rest,
    // and `expo-router-header-options` is the entry about why that gap
    // matters: a census proves code is present, never that it appears.
    expect(text).toContain("{lines.length > 0 && (");
  });

  it("keeps the red badge for the one state that is actually wrong", () => {
    // A bid past its deadline that was never sent. That is the claim the old
    // badge was making and almost never true of; it is true of this.
    expect(source()).toContain("past the deadline and never sent");
  });

  it("colours a row's date only when the colour means something", () => {
    const text = source();
    expect(text).not.toContain('className={bidRow.overdue ? "text-tag-rose-ink" : undefined}');
    expect(text).toContain('byId.get(bidRow.id) === "MISSED"');
  });
});
