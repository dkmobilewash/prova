import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A TAB THAT FETCHES MUST REFETCH WHEN YOU COME BACK TO IT.
 *
 * A tab screen stays MOUNTED when you switch away from it, so an effect
 * keyed on mount runs exactly once per app launch. The list you saw at
 * breakfast is the list you see at four — with no stale note, because the
 * one fetch it did reached the server and was right at the time.
 *
 * MEASURED, not reasoned about. On 2026-10-03 a contact and its dates were
 * deleted on the web; `/alerts` there went to "Nothing needs attention", and
 * the phone's Alerts tab still showed all three through tab switches and an
 * app resume. Pull-to-refresh cleared it — which is the problem, not the
 * answer: the one list whose entire job is to be current only updated if you
 * already distrusted it.
 *
 * **THIS IS A SOURCE CENSUS AND IT SAYS SO.** No test in this repo can tell
 * `useFocusEffect` from `useEffect`, because `screens/setup.tsx` mocks the
 * first as the second — in a test the screen is mounted and therefore
 * focused, which is the right mock and also blinds every behavioural test to
 * this defect. Same shape as the expo-router header entry in CLAUDE.md: a
 * check can prove the code is present and never that the framework honours
 * it. So this asserts the call is THERE, and the phone is what proves it
 * works.
 */

const TABS = join(__dirname, "..", "app", "(tabs)");

function source(file: string): string {
  // Comments stripped: this very file's header names both hooks, and so do
  // the screens'. A raw-text census would pass on a comment.
  return readFileSync(join(TABS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const files = readdirSync(TABS).filter((f) => f.endsWith(".tsx"));

describe("every tab that reads also refreshes on focus", () => {
  it("walks a real directory with the tabs actually in it", () => {
    // SCOPE, pinned to something that cannot drift with the pattern:
    // nothing is ever missing from a directory you do not walk.
    expect(files.length, "the (tabs) directory parsed to nothing").toBeGreaterThanOrEqual(5);
    expect(files).toContain("alerts.tsx");
    expect(files).toContain("_layout.tsx");
  });

  it("finds the fetching tabs, and there are some", () => {
    const fetching = files.filter((f) => source(f).includes("cachedRead"));
    // SIZE: a pattern that matched nothing would make every assertion
    // below vacuously true.
    expect(fetching.length, "no tab appears to fetch — the pattern has drifted").toBeGreaterThanOrEqual(3);
  });

  it("gives every fetching tab a focus refresh", () => {
    const missing = files
      .filter((f) => source(f).includes("cachedRead"))
      // THE CALL, not the NAME. The first version of this census matched
      // the bare string and went GREEN against a mutation that reverted the
      // real fix — because reverting it left `useFocusEffect` sitting in the
      // import line. A census that counts an import as a usage is measuring
      // nothing.
      .filter((f) => !/useFocusEffect\s*\(/.test(source(f)));
    expect(
      missing,
      "these tabs fetch on mount and never again, so they age silently while you use the app",
    ).toEqual([]);
  });
});
