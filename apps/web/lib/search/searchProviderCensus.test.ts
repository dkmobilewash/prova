/**
 * The guard the founder's ask required by name: this fails when a new
 * searchable record type is added without a real capability gate behind
 * it, and it is written so it CAN fail — CLAUDE.md's own rule ("a guard
 * that cannot fail is worse than no guard") applied to this feature.
 *
 * Five separate checks, each closing one way this could leak silently:
 *
 *   1. Every provider `providers.ts` DEFINES is actually REGISTERED in
 *      `SEARCH_PROVIDERS` — counted independently, by reading the file off
 *      disk and counting `gate: "..."` literals, never by trusting the
 *      array it is checking. Same method `walkthroughCensus.test.ts` uses
 *      for `data-tour` literals, for the same reason: a check that derives
 *      its own input can pass vacuously on an empty set, so the count is
 *      pinned to a source that cannot drift with it (CLAUDE.md's SQL-regex
 *      trap entry is the concrete case this already happened once here).
 *   2. Every provider has a unique, well-formed `type`.
 *   3. A route-gated provider's route is a REAL page on disk — a typo'd
 *      route would make `capabilityForRoute()` return null (not found) and
 *      that reads identically to a route deliberately left open.
 *   4. A tool-gated provider's tool name really exists in `TOOLS`.
 *   5. THE SECURITY CHECK: every provider's capability, resolved by the
 *      exact function `globalSearch` calls at request time
 *      (`providerCapability` in `./query.ts`), matches an independently
 *      hand-written, hand-reasoned expectation below — and every provider
 *      left open has a written reason for it, mirroring
 *      `lib/walkthroughs/index.ts`'s `ROUTES_WITHOUT_WALKTHROUGH` shape:
 *      absence of a capability is a decision, never a default.
 *
 * Check 5 is the one that actually matters and the one worth mutating by
 * hand before trusting it — see the PR description for the mutation run
 * (each check above broken, confirmed red, restored, confirmed green).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pages } from "@/lib/walkthroughs/census-helpers";
import { TOOLS } from "@/lib/ask/tools";
import type { Capability } from "@/lib/permissions";
import { providerCapability } from "./query";
import { SEARCH_PROVIDERS } from "./providers";

const PROVIDERS_FILE = new URL("./providers.ts", import.meta.url);

function gateLiteralsByGrep(): string[] {
  const source = readFileSync(PROVIDERS_FILE, "utf8");
  return [...source.matchAll(/gate:\s*"(route|tool)"/g)].map((match) => match[1]);
}

/**
 * The one hand-reasoned line per provider. This is the part of the file
 * that is actually a security assertion rather than a structural one —
 * everything above exists to make sure THIS table cannot be bypassed by a
 * provider that skips registration, cites a dead route, or cites a dead
 * tool. Each line names the source it was reasoned from, the same way
 * `EXPECTED_CAPABILITY`-shaped tables read elsewhere in this codebase
 * (`tools.test.ts`'s citation pins) do.
 */
const EXPECTED_CAPABILITY: Record<string, Capability | null> = {
  job: null, // /dashboard is open. Mirrors job_overview's no-capability slice: name/status/GC, no money.
  contact: null, // /contacts has no ROUTE_CAPABILITY entry. contact_lookup: "names and phone numbers are not a tier."
  crew: null, // /team has no ROUTE_CAPABILITY entry. team_roster's own comment: "a roster of who works here is not a tier" (its primary citation).
  vendor: null, // /vendors has no ROUTE_CAPABILITY entry -- same open tier as contacts.
  rfi: "MANAGE_JOBS", // ROUTE_CAPABILITY["/rfis"]
  submittal: "MANAGE_JOBS", // ROUTE_CAPABILITY["/submittals"]
  punchListItem: "MANAGE_FIELD", // ROUTE_CAPABILITY["/punch-lists"]
  drawing: "MANAGE_JOBS", // ROUTE_CAPABILITY["/drawings"]
  changeOrder: "VIEW_JOB_COSTS", // TOOLS["change_order_status"].capability
  invoice: "MANAGE_BILLING", // TOOLS["pay_application_status"].capability
};

/** Every provider left open (capability: null) needs a reason ON RECORD --
 * same shape as ROUTES_WITHOUT_WALKTHROUGH in lib/walkthroughs/index.ts. */
const OPEN_PROVIDER_REASONS: Record<string, string> = {
  job: "job_overview's no-capability slice shows name/status/GC before any money section.",
  contact: "contact_lookup's own description: names and phone numbers are not a tier.",
  crew: "team_roster's own comment on its primary citation: a roster of who works here is not a tier.",
  vendor: "same open tier as contacts; /vendors carries no ROUTE_CAPABILITY entry.",
};

describe("global search provider census", () => {
  it("registers exactly the providers providers.ts defines", () => {
    const grepped = gateLiteralsByGrep();
    expect(grepped.length, 'no `gate: "…"` literals found -- is providers.ts empty or unreadable?').toBeGreaterThan(0);
    expect(
      SEARCH_PROVIDERS.length,
      `providers.ts defines ${grepped.length} providers by their "gate:" literal, but SEARCH_PROVIDERS only ` +
        `registers ${SEARCH_PROVIDERS.length}. A provider was written and never pushed into the array -- the ` +
        '"written, documented and never called" shape CLAUDE.md\'s Traps section names twice already.',
    ).toBe(grepped.length);
  });

  it("gives every provider a unique, well-formed type", () => {
    for (const provider of SEARCH_PROVIDERS) {
      expect(provider.type, `provider labelled "${provider.label}" has a malformed type "${provider.type}"`).toMatch(
        /^[a-zA-Z]+$/,
      );
    }
    const types = SEARCH_PROVIDERS.map((provider) => provider.type);
    expect(new Set(types).size, `duplicate provider type in ${JSON.stringify(types)}`).toBe(types.length);
  });

  it("points every route-gated provider at a route that is a real page on disk", () => {
    for (const provider of SEARCH_PROVIDERS) {
      if (provider.gate !== "route") continue;
      expect(
        pages.has(provider.route),
        `"${provider.type}" cites route "${provider.route}", which is not a real page under apps/web/app/(app). ` +
          "A typo'd route makes capabilityForRoute() return null -- OPEN -- indistinguishably from a route " +
          "deliberately left open. Fix the route, or build the page.",
      ).toBe(true);
    }
  });

  it("points every tool-gated provider at a tool that exists in lib/ask/tools.ts", () => {
    for (const provider of SEARCH_PROVIDERS) {
      if (provider.gate !== "tool") continue;
      expect(
        TOOLS.some((tool) => tool.name === provider.toolName),
        `"${provider.type}" cites Ask tool "${provider.toolName}", which TOOLS does not define -- renamed or removed?`,
      ).toBe(true);
    }
  });

  it("has a written expectation for every registered provider, and no orphaned expectation for a retired one", () => {
    const registered = new Set(SEARCH_PROVIDERS.map((provider) => provider.type));
    const expected = new Set(Object.keys(EXPECTED_CAPABILITY));
    expect(
      [...registered].sort(),
      "SEARCH_PROVIDERS and this file's EXPECTED_CAPABILITY table name different providers -- a new provider " +
        "shipped with no reasoned capability recorded here, or a retired one left a stale entry behind.",
    ).toEqual([...expected].sort());
  });

  it("resolves every provider's capability -- via the exact function globalSearch calls -- to the written expectation", () => {
    for (const provider of SEARCH_PROVIDERS) {
      const actual = providerCapability(provider);
      const expected = EXPECTED_CAPABILITY[provider.type];
      const source =
        provider.gate === "route" ? `capabilityForRoute("${provider.route}")` : `TOOLS["${provider.toolName}"].capability`;
      expect(
        actual,
        `"${provider.type}" resolves to ${JSON.stringify(actual)} at search time (via ${source}), but this file's ` +
          `expectation says ${JSON.stringify(expected)}. Either ROUTE_CAPABILITY or tools.ts moved under this ` +
          "provider (read the diff before touching either) or the expectation above is stale -- both are decisions, never a silent pass.",
      ).toBe(expected);
    }
  });

  it("requires a written reason for every provider left open, and only for those", () => {
    for (const [type, capability] of Object.entries(EXPECTED_CAPABILITY)) {
      if (capability !== null) continue;
      expect(
        OPEN_PROVIDER_REASONS[type],
        `"${type}" is open (capability: null) with no reason recorded in OPEN_PROVIDER_REASONS.`,
      ).toBeTruthy();
    }
    for (const type of Object.keys(OPEN_PROVIDER_REASONS)) {
      expect(
        EXPECTED_CAPABILITY[type] ?? null,
        `OPEN_PROVIDER_REASONS has a reason recorded for "${type}", but that provider is gated or no longer exists.`,
      ).toBeNull();
    }
  });
});
