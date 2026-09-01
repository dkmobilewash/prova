import { describe, expect, it } from "vitest";
import { CONNECTION_CARD_SELECT, CREDENTIAL_FIELDS } from "./selects";

describe("what the Integrations page is allowed to read", () => {
  it("selects no credential column", () => {
    // The guard that matters. If someone adds an encrypted envelope to this
    // select, the page can forward it to a client component and it lands in
    // the RSC payload — a credential in a browser, with nothing on screen to
    // show for it. This fails first instead.
    for (const field of CREDENTIAL_FIELDS) {
      expect(Object.keys(CONNECTION_CARD_SELECT)).not.toContain(field);
    }
  });

  it("selects nothing that merely looks like a credential either", () => {
    // Catches a differently-named column arriving later — encryptedSecret,
    // apiKey, clientSecret — without this test needing to know its name.
    const suspicious = /token|secret|password|credential|apikey/i;
    const offenders = Object.keys(CONNECTION_CARD_SELECT).filter((key) => suspicious.test(key));
    expect(offenders).toEqual([]);
  });

  it("still selects what the card actually renders", () => {
    // The other half: a select trimmed too far renders a blank card, which
    // is the failure this codebase keeps meeting — a page that looks fine
    // and says nothing true.
    for (const field of ["status", "externalAccountLabel", "lastSyncedAt", "scopes"]) {
      expect(Object.keys(CONNECTION_CARD_SELECT)).toContain(field);
    }
  });
});
