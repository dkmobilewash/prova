import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY VALUE THE APP READS AT BUILD TIME IS SUPPLIED BY THE THING THAT
 * BUILDS IT — and this file exists because the two had never been
 * connected at all.
 *
 * `EXPO_PUBLIC_*` variables are baked into the bundle when it is built.
 * On a laptop they come from `apps/mobile/.env`, which is gitignored;
 * Expo's docs say plainly that .env files "are not available for jobs
 * that run on a remote server, for example, EAS Build". So before this,
 * the first cloud build would have shipped with NO server address and NO
 * sign-in key: it installs, it launches, and then it reports "No
 * connection" forever, because the address it fell back to — localhost —
 * is the phone itself.
 *
 * Nothing could catch that. Typecheck cannot see a missing environment
 * variable, the unit suites run on a laptop where .env exists, and the
 * failure only appears on a device somebody else is holding.
 *
 * So: the app's own source is the list of what a build must carry, and
 * `eas.json` must account for every one of them — either with a literal
 * value in the profile, or by being named here as coming from the EAS
 * environment, with a reason. A new `EXPO_PUBLIC_` read that nobody has
 * wired fails the build on a laptop in a second.
 *
 * Per CLAUDE.md, a check that DERIVES its input asserts the size of what
 * it found against a source that cannot drift with the pattern — a regex
 * that matches nothing would otherwise pass every assertion below it.
 */

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const root = join(__dirname, "..");
const sources = [
  ...listFiles(join(root, "app")),
  ...listFiles(join(root, "lib")),
  ...listFiles(join(root, "components")),
].filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."));

const eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8")) as {
  build: Record<string, { environment?: string; env?: Record<string, string> }>;
};

/**
 * Variables a profile deliberately does NOT hardcode, and why. The value
 * is the reason, which is the part worth reading — an allowlist without
 * one is just a way to silence the check.
 */
const FROM_EAS_ENVIRONMENT: Record<string, Record<string, string>> = {
  development: {
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
      "the development instance's pk_test key — a key belongs in the EAS environment, not the repo",
    EXPO_PUBLIC_API_URL:
      "a dev client loads its JS from Metro, so the laptop's .env decides; and a hardcoded localhost would be wrong anyway, because on a device localhost is the device",
  },
  preview: {
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
      "the development instance's pk_test key, same reason as development",
    EXPO_PUBLIC_API_URL:
      "a preview build must be TOLD which deployment it tests; defaulting it to production has testers writing real rows",
  },
  production: {
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
      "the production instance's pk_live key — a key belongs in the EAS environment, not the repo",
  },
};

describe("a cloud build carries what the app reads", () => {
  it("finds the variables the app actually reads", () => {
    expect(readVars().size).toBeGreaterThan(1);
  });

  it("parses every process.env read, so a dead pattern cannot pass", () => {
    // The size half. Counting the accessor literal is a different
    // mechanism from the capture below, so the two cannot rot together.
    let declared = 0;
    for (const file of sources) {
      declared += (readFileSync(file, "utf8").match(/process\.env\.EXPO_PUBLIC_/g) ?? []).length;
    }
    expect(occurrences(), "the parse lost an EXPO_PUBLIC read").toBe(declared);
  });

  it("accounts for every variable in every build profile", () => {
    const vars = [...readVars()];
    const gaps: string[] = [];
    for (const [profile, config] of Object.entries(eas.build)) {
      for (const name of vars) {
        const inline = config.env?.[name];
        const declared = FROM_EAS_ENVIRONMENT[profile]?.[name];
        if (inline) continue;
        if (declared && declared.length > 20) continue;
        gaps.push(`${profile} supplies no ${name}`);
      }
    }
    expect(
      gaps,
      `these builds would install and then fail to reach anything: ${gaps.join(", ")}`,
    ).toEqual([]);
  });

  it("gives every profile an EAS environment to read its keys from", () => {
    const missing = Object.entries(eas.build)
      .filter(([, config]) => !config.environment)
      .map(([profile]) => profile);
    expect(missing, `profiles with no environment: ${missing.join(", ")}`).toEqual([]);
  });

  it("points the production profile at production, not a laptop", () => {
    // The one that would reach TestFlight. localhost on a phone is the
    // phone, and a preview URL is somebody else's database.
    const url = eas.build.production?.env?.EXPO_PUBLIC_API_URL;
    expect(url).toBe("https://app.cstream.ai");
  });

  it("keeps .env.example naming every variable a laptop needs", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    const missing = [...readVars()].filter((name) => !example.includes(name));
    expect(missing, `.env.example never mentions: ${missing.join(", ")}`).toEqual([]);
  });
});

/** Every `EXPO_PUBLIC_` variable the app reads, from the app itself. */
function readVars(): Set<string> {
  const found = new Set<string>();
  for (const file of sources) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g,
    )) {
      found.add(match[1]);
    }
  }
  return found;
}

/** How many reads the capture pattern saw, duplicates included. */
function occurrences(): number {
  let count = 0;
  for (const file of sources) {
    count += [
      ...readFileSync(file, "utf8").matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g),
    ].length;
  }
  return count;
}
