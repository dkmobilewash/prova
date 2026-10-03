import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACC_REQUIRED_ENV } from "@/lib/acc/setup";
import { BLUEBEAM_REQUIRED_ENV } from "@/lib/bluebeam/setup";
import { COMPANYCAM_REQUIRED_ENV } from "@/lib/companycam/setup";
import { DOCUSIGN_REQUIRED_ENV } from "@/lib/docusign/setup";
import { JOBBER_REQUIRED_ENV } from "@/lib/jobber/setup";
import { PROCORE_REQUIRED_ENV } from "@/lib/procore/setup";

/**
 * A VARIABLE NOBODY CAN DISCOVER IS A FEATURE NOBODY CAN TURN ON.
 *
 * Until 2026-10-02 `apps/web/.env.example` documented QuickBooks and NOT ONE of
 * the other seven OAuth integrations — not `JOBBER_*`, `COMPANYCAM_*`,
 * `DOCUSIGN_*`, `PROCORE_*`, `ACC_*`, `BLUEBEAM_*`, nor the
 * `INTEGRATION_TOKEN_KEY` that every one of them additionally requires. Setting
 * any of them up meant reading `lib/<provider>/setup.ts` to find out the names
 * existed at all.
 *
 * That is its own quiet failure mode, and a nastier one than a crash: with the
 * variables unset each card renders a "Not set up" pill and no button, which is
 * CORRECT behaviour and looks exactly like a broken feature. An audit of all
 * eight integrations found the code honest and every round trip closed — the
 * thing actually missing was the ability to configure them.
 *
 * So this census pins the example file to the code. Each provider's
 * `*_REQUIRED_ENV` is the list the card itself checks before offering a Connect
 * button, which makes it the right source: a name that appears there and not in
 * the example file is a name an operator cannot find.
 *
 * IT IMPORTS THE CONSTANTS RATHER THAN GREPPING FOR THEM. A regex over
 * `setup.ts` would be the shape this repo distrusts — it can match nothing and
 * pass everything downstream, and `ACC_REQUIRED_ENV` would defeat it anyway,
 * since it is built from `ACC_ENV.clientId` and friends rather than from string
 * literals. Importing the real array cannot drift from what the app reads.
 *
 * It deliberately does NOT check the optional ones (`PROCORE_ENVIRONMENT`,
 * `BLUEBEAM_REGION`, `DOCUSIGN_CONNECT_HMAC_KEY`). Those change behaviour but no
 * card refuses without them, so they are documentation rather than
 * configuration, and pinning them here would make this test about prose.
 */

const EXAMPLE = fileURLToPath(new URL("../../.env.example", import.meta.url));

/** Only the left-hand side of an assignment counts. A name that appears solely
 *  inside a comment is prose about a variable, not a slot to fill in — and this
 *  file's own block comments mention several by name. */
function assignedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (match) names.add(match[1]);
  }
  return names;
}

const PROVIDERS = {
  Jobber: JOBBER_REQUIRED_ENV,
  CompanyCam: COMPANYCAM_REQUIRED_ENV,
  DocuSign: DOCUSIGN_REQUIRED_ENV,
  Procore: PROCORE_REQUIRED_ENV,
  "Autodesk Construction Cloud": ACC_REQUIRED_ENV,
  Bluebeam: BLUEBEAM_REQUIRED_ENV,
} as const;

describe("every variable an integration requires is in .env.example", () => {
  const text = readFileSync(EXAMPLE, "utf8");
  const declared = assignedNames(text);

  it("read an example file with real assignments in it", () => {
    /* SIZE AND SCOPE FIRST. If the path were wrong or the parser stopped
     * matching, `declared` would be empty and every assertion below would pass
     * about nothing — nothing is ever missing from an empty set. */
    expect(
      declared.size,
      "almost nothing parsed out of .env.example — the path or the assignment " +
        "pattern is wrong, and the checks below would pass vacuously",
    ).toBeGreaterThanOrEqual(20);

    /* And a control on the other side: the provider lists must be non-empty,
     * or "every required name is documented" is a claim about nothing. */
    for (const [provider, required] of Object.entries(PROVIDERS)) {
      expect(required.length, `${provider} declares no required env vars`).toBeGreaterThanOrEqual(3);
    }
  });

  it("documents every name each card checks before offering Connect", () => {
    const missing: string[] = [];
    for (const [provider, required] of Object.entries(PROVIDERS)) {
      for (const name of required) {
        if (!declared.has(name)) missing.push(`${provider}: ${name}`);
      }
    }

    expect(
      missing,
      "These variables are what the integrations page checks before it will " +
        "offer a Connect button, and they appear nowhere in .env.example. " +
        "Without them each card reads 'Not set up' with no button — correct " +
        "behaviour that looks exactly like a broken feature, and the operator " +
        "has no way to learn the name they are missing.\n\n" +
        "Add each one, with a line saying what it is for.",
    ).toEqual([]);
  });

  it("documents the one key all seven share", () => {
    /* Called out separately because it is the single point of failure: without
     * it EVERY card reads "not set up" however complete the rest is, and
     * nothing in the UI says which of the two problems you have. */
    expect(
      declared.has("INTEGRATION_TOKEN_KEY"),
      "INTEGRATION_TOKEN_KEY encrypts every stored OAuth token and is required " +
        "by all seven providers. Undocumented, it is the one variable whose " +
        "absence disables everything at once.",
    ).toBe(true);
  });
});
