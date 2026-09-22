/**
 * Copy that a contractor clicking a preview flagged, pinned so it cannot
 * drift back. Each case names the file it reads; the censuses below read the
 * STRINGS a file carries through the TypeScript parser (lib/source-literals.ts)
 * so a comment explaining the old wording can never trip or satisfy them.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appSourceFiles, fileLiterals } from "@/lib/source-literals";
import { TRADE_SCOPE_OPTIONS } from "@/lib/trade-scopes";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const literalsOf = (rel: string) => fileLiterals(join(WEB, rel));

describe("change-order forms", () => {
  const texts = literalsOf("components/ChangeOrders.tsx").map((l) => l.text);

  it("use wall-and-ceiling examples, not a residential kitchen", () => {
    expect(texts.filter((t) => /backsplash|\btile\b/i.test(t))).toEqual([]);
    expect(texts).toContain("Add rated head-of-wall at corridor");
    expect(texts).toContain("2-hr rated deflection track");
  });

  it("label trade scopes from the shared list, never the enum lowercased", () => {
    // `.replaceAll("_", " ")` on the enum is what printed "eifs" and "lath plaster".
    expect(texts).not.toContain("_");
  });

  it("the shared list writes EIFS in capitals and keeps its stored values", () => {
    expect(TRADE_SCOPE_OPTIONS.find((o) => o.value === "EIFS")?.label).toBe("EIFS");
    expect(TRADE_SCOPE_OPTIONS.map((o) => o.value)).toEqual([
      "METAL_FRAMING_DRYWALL",
      "LATH_PLASTER",
      "EIFS",
      "ACOUSTICAL_CEILINGS",
      "FIREPROOFING",
    ]);
  });
});

describe("/safety", () => {
  it("says 'No cases logged' once — the status line owns it, the empty state does not repeat it", () => {
    const visible = literalsOf("app/(app)/safety/page.tsx")
      .filter((l) => l.kind === "jsx-text")
      .map((l) => l.text)
      .join(" ");
    expect(visible).not.toMatch(/No cases logged/);
    expect(visible).toMatch(/That is the good outcome/);
  });
});

/** US spelling and the brand's written name, across every string the app
 * carries. SCOPE: app, components and lib, every non-test .ts/.tsx; SIZE: the
 * scan must see thousands of strings and must see the brand written right,
 * so a scanner that returns nothing fails instead of passing. */
describe("US spelling and 'C Stream' in user-facing strings", () => {
  const all = (["app", "components", "lib"] as const).flatMap((root) =>
    appSourceFiles(join(WEB, root)).flatMap((file) =>
      fileLiterals(file).map((l) => ({ file: file.slice(WEB.length + 1), text: l.text })),
    ),
  );

  it("the scan is not empty", () => {
    expect(all.length).toBeGreaterThan(10_000);
    expect(all.some((l) => l.text.includes("C Stream"))).toBe(true);
  });

  const offenders = (pattern: RegExp) => all.filter((l) => pattern.test(l.text)).map((l) => `${l.file}: ${l.text.trim().slice(0, 80)}`);

  it("says program, not programme", () => {
    expect(offenders(/\bprogrammes?\b/i)).toEqual([]);
  });

  it("says check, not cheque", () => {
    expect(offenders(/\bcheques?\b/i)).toEqual([]);
  });

  it("writes the brand as C Stream, not cstream", () => {
    // `cstream.ai`, `cstream:walkthrough` storage keys and
    // `/brand/cstream-wordmark.png` are identifiers, not prose.
    expect(offenders(/\bcstream\b(?![.:\-/_])/)).toEqual([]);
  });
});
