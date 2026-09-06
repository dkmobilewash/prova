import { describe, expect, it } from "vitest";
import {
  SIGNING_LINK_MAX_AGE_DAYS,
  portalAccessFor,
  signingLinkExpiresOn,
  signingLinkState,
} from "./link-access";

/**
 * The gates on the two links in this app that have no login behind them.
 *
 * Both were permanent: one writer each, no delete, no expiry, no reader
 * that asked whether the token was still allowed. These tests pin what each
 * gate answers, and — the part that earns its keep — that the two states
 * which must NEVER be gated are not: a SIGNED contract renders forever, and
 * a live link inside its window keeps working.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-05T12:00:00.000Z");

const estimate = { status: "ESTIMATE" };

describe("the portal link", () => {
  it("opens for an active contact", () => {
    expect(portalAccessFor({ status: "ACTIVE" }).ok).toBe(true);
  });

  it("opens for a prospect — they are being courted, not cut off", () => {
    expect(portalAccessFor({ status: "PROSPECT" }).ok).toBe(true);
  });

  it("is refused once the contact is INACTIVE", () => {
    const access = portalAccessFor({ status: "INACTIVE" });
    expect(access.ok).toBe(false);
    expect(access.ok === false && access.reason).toBe("CONTACT_INACTIVE");
  });
});

describe("the signing link", () => {
  it("is signable inside its window", () => {
    const createdAt = new Date(NOW.getTime() - 3 * DAY);
    expect(signingLinkState({ status: "PENDING", createdAt }, estimate, NOW).state).toBe("SIGNABLE");
  });

  it("is still signable on the last day of the window", () => {
    // The boundary, not a day either side of it. An off-by-one here kills a
    // link a day early, which the GC experiences as the software breaking.
    const createdAt = new Date(NOW.getTime() - SIGNING_LINK_MAX_AGE_DAYS * DAY);
    expect(signingLinkState({ status: "PENDING", createdAt }, estimate, NOW).state).toBe("SIGNABLE");
  });

  it("expires one millisecond past the window", () => {
    const createdAt = new Date(NOW.getTime() - SIGNING_LINK_MAX_AGE_DAYS * DAY - 1);
    expect(signingLinkState({ status: "PENDING", createdAt }, estimate, NOW).state).toBe("EXPIRED");
  });

  it("refuses once the job has left ESTIMATE by any route", () => {
    // The GC sent an executed subcontract, or somebody marked it contracted.
    // A forgotten link must not be able to sign a job already under contract.
    const createdAt = new Date(NOW.getTime() - DAY);
    expect(
      signingLinkState({ status: "PENDING", createdAt }, { status: "CONTRACTED" }, NOW).state,
    ).toBe("JOB_NOT_ESTIMATE");
  });

  it("renders a SIGNED contract forever — expiry never touches evidence", () => {
    // Ten years old, on a closed job. A signed contract is the record and
    // its page must still open. If this ever goes red, the fix is in
    // signingLinkState, never in the test.
    const createdAt = new Date(NOW.getTime() - 3650 * DAY);
    expect(
      signingLinkState({ status: "SIGNED", createdAt }, { status: "CLOSED" }, NOW).state,
    ).toBe("SIGNED");
  });

  it("reports the date it stops working", () => {
    const createdAt = new Date("2026-09-01T00:00:00.000Z");
    expect(signingLinkExpiresOn(createdAt).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
