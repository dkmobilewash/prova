import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AI_FEATURES } from "@prova/integrations";

/**
 * THE APP'S FEATURE LIST AND THE DATABASE'S ENUM ARE THE SAME SET.
 *
 * `CompanyAiSettings.disabledFeatures` is `AiFeature[]`, so the per-company
 * switch can only refuse a feature the ENUM has. `aiSettings.ts` builds that
 * array from the app's keys and casts it — `AI_FEATURE_KEYS.filter(...) as
 * AiFeature[]` — which silences the one check TypeScript could have made here.
 *
 * ── WHAT THAT CAST COST, MEASURED FROM THE MIGRATIONS ──
 *
 * `add_company_ai_settings` created the type with seven values and three
 * `ADD VALUE` migrations brought it to ten. The app had TWELVE keys, each with
 * its own toggle on Settings → Assistant. `SCHEDULE_READ` and `PROPOSAL_DRAFT`
 * had no member.
 *
 * The failure is worse than the obvious one. A missing member does not make a
 * toggle do nothing — it makes the WRITE INVALID. Unchecking either box sent
 * Postgres an enum value it does not have, the upsert was refused, and every
 * other setting on that form went down with it. An owner switching one feature
 * off could not save any of them.
 *
 * ── WHY A CENSUS AND NOT A TYPE ──
 *
 * `aiFeatureEnum` is `return feature as AiFeature`. It looks like a conversion
 * and is a cast, so the compiler has nothing to say about a key with no member.
 * Making it a total `Record<AiFeatureKey, AiFeature>` would have caught this
 * and is the better fix in a world where the enum is generated; here the enum
 * is Prisma's, the keys are ours, and the only thing that can compare them is
 * something that reads both files.
 *
 * ── BOTH ENDS ARE DERIVED, AND BOTH SIZES ARE ASSERTED ──
 *
 * This repo has paid twice for a census that parsed its own subject into an
 * empty set and passed: `scratch-cleanup-order.test.ts` (#224) had a pattern one
 * line break from matching nothing, and `theme-contrast.test.ts` had the right
 * pattern and the wrong directory. So the enum members are counted against a
 * second expression that shares no regex with the first, and the migration
 * trail is read separately — because the schema file says what Prisma INTENDS
 * and the migrations say what the database ENFORCES, and this bug lived in the
 * gap between those two.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCHEMA = join(HERE, "../../../../packages/db/prisma/schema/ai-settings.prisma");
const MIGRATIONS = join(HERE, "../../../../packages/db/prisma/schema/migrations");

/** The `enum AiFeature { … }` block, with its doc comments stripped. */
function enumBlock(): string {
  const source = readFileSync(SCHEMA, "utf8");
  const at = source.indexOf("enum AiFeature {");
  expect(at, "no `enum AiFeature` in ai-settings.prisma").toBeGreaterThan(-1);
  const end = source.indexOf("\n}", at);
  expect(end, "the enum block never closes").toBeGreaterThan(at);
  return source
    .slice(at, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("///"))
    .join("\n");
}

describe("the AI feature list and the schema enum", () => {
  const block = enumBlock();
  const members = [...block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*$/gm)].map((m) => m[1]);
  const keys = Object.keys(AI_FEATURES);

  it("PARSES THE ENUM AT ALL — a pattern matching nothing must fail loudly", () => {
    // The size assertion, against an expression sharing no regex with the one
    // that produced `members`: every non-blank line of the block that is not
    // the header is a member.
    const lines = block
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(members.length, "the member pattern and the line count disagree").toBe(lines.length);
    expect(members.length).toBeGreaterThan(5);
  });

  it("HAS A MEMBER FOR EVERY FEATURE THE APP CAN SWITCH OFF", () => {
    const missing = keys.filter((key) => !members.includes(key));
    expect(
      missing,
      "these features have a toggle on Settings → Assistant and no enum member, so unchecking one makes the whole save fail",
    ).toEqual([]);
  });

  it("has no member the app does not know about", () => {
    // The other direction, which is harmless at runtime and still wrong: a
    // member nothing can set is a value in the database with no meaning, and
    // the next person reading the enum takes it for a live feature.
    const extra = members.filter((member) => !keys.includes(member));
    expect(extra, "enum members no feature key names").toEqual([]);
  });

  it("EVERY MEMBER IS IN THE MIGRATIONS, which is what the database enforces", () => {
    // The schema file is what Prisma intends; the migrations are what Postgres
    // has. This bug lived in the gap, so the gap is what this asserts.
    const applied = new Set<string>();
    let files = 0;
    for (const dir of readdirSync(MIGRATIONS)) {
      let sql: string;
      try {
        sql = readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");
      } catch {
        continue;
      }
      files += 1;
      const created = sql.match(/CREATE TYPE "AiFeature" AS ENUM \(([^)]*)\)/);
      if (created) for (const one of created[1].matchAll(/'([A-Z0-9_]+)'/g)) applied.add(one[1]);
      for (const one of sql.matchAll(/ALTER TYPE "AiFeature" ADD VALUE '([A-Z0-9_]+)'/g)) {
        applied.add(one[1]);
      }
    }
    expect(files, "no migrations were read, so this test proves nothing").toBeGreaterThan(10);
    expect(applied.size, "no AiFeature values were parsed out of the migrations").toBeGreaterThan(5);
    const never = members.filter((member) => !applied.has(member));
    expect(never, "schema members that no migration ever added to the database").toEqual([]);
  });
});
