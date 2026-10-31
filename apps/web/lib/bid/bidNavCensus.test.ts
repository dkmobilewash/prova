import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_FOOTER, NAV_GROUPS, NAV_ITEMS, navGroupsFor } from "@/components/navItems";
import { navTargetsInFile } from "./navTargets";
import { sourceLiterals } from "@/lib/source-literals";
import { isBidPath } from "./surface";

/**
 * THE CRM's NAV NEVER OFFERS C STREAM BID — the other half of
 * `bidLinkCensus.test.ts`. The products are not reachable from each other in
 * EITHER direction (founder's call, 2026-10-25), and the CRM's nav is where a
 * well-meaning "add Bid to the menu" would land first.
 *
 * Read two ways, so neither can pass by not looking:
 *   - the RUNTIME nav: every href in `NAV_ITEMS`, `NAV_GROUPS`, `NAV_FOOTER`,
 *     and what `navGroupsFor` hands the shell for an owner with every option
 *     on (which adds the operator-only Internal group);
 *   - the SOURCE: every string and template literal in `navItems.tsx` and the
 *     shell's own nav components, through the TypeScript parser — so an entry
 *     added outside the exported arrays, or a `/bid` link drawn by the top bar
 *     directly, is caught too. Comments are not literals.
 *
 * SIZE: the parse must see every runtime NAV_ITEMS href as a literal `href:`
 * property, so a parse that stopped reading the file cannot pass as "no /bid".
 */

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const NAV_FILE = join(webRoot, "components", "navItems.tsx");
const SHELL_DIR = join(webRoot, "components", "shell");

const owner = { role: "OWNER" as const, jobFunction: null };

describe("the CRM nav has no Bid entry", () => {
  it("at runtime, in every list the shell renders", () => {
    const hrefs = [
      ...NAV_ITEMS.map((i) => i.href),
      ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
      ...NAV_FOOTER.map((i) => i.href),
      ...navGroupsFor(owner, { showsInternal: true }).flatMap((g) => g.items.map((i) => i.href)),
    ];
    expect(hrefs.length).toBeGreaterThan(30);
    expect(hrefs.filter(isBidPath)).toEqual([]);
  });

  it("in the source of navItems.tsx and the shell's nav components", () => {
    expect(existsSync(SHELL_DIR)).toBe(true);
    const files = [
      NAV_FILE,
      ...readdirSync(SHELL_DIR)
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
        .map((f) => join(SHELL_DIR, f)),
    ];
    expect(files.length).toBeGreaterThan(3);
    const offenders = files.flatMap((file) =>
      sourceLiterals(readFileSync(file, "utf8"), file)
        .filter((l) => l.kind !== "jsx-text" && isBidPath(l.text.split(/[?#]/)[0]))
        .map((l) => `${file}: ${JSON.stringify(l.text)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the parse sees every runtime nav entry (it is reading the file)", () => {
    const parsed = new Set(
      navTargetsInFile(NAV_FILE)
        .filter((t) => t.sink === "prop-href" && !t.dynamic)
        .map((t) => t.text),
    );
    expect(parsed.size).toBeGreaterThanOrEqual(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) expect(parsed.has(item.href), item.href).toBe(true);
  });
});
