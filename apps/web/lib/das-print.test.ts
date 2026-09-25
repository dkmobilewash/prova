import { describe, expect, it } from "vitest";
import {
  buildDas140,
  buildDas142,
  DAS140_ELECTIONS,
  DAS_BLOCKING_REASON,
  das140ElectionLabel,
  type DasBlockingField,
  type DasCommitteeInput,
  type DasCompanyInput,
  type DasJobInput,
} from "./das-print";

/**
 * The two printed forms, and the one rule that matters: NOTHING IS INVENTED.
 *
 * A committee address, a program sponsor number or a licence number that this
 * app guessed and printed on a document the state receives is worse than a
 * blank one, because nobody re-checks a filled box. Every test below is a
 * different way of asking "did it make something up", and each one that
 * passes is a field that comes back as BLOCKING with a sentence instead.
 *
 * The secondary guidance on the DAS 140 says writing "TBD", "N/A" or leaving
 * a blank invalidates the form, so `sendable` must be false whenever anything
 * is blocking — there is no partial-credit state.
 */

const company: DasCompanyInput = {
  name: "Acme Wall & Ceiling",
  dbaName: null,
  hqAddressLine1: "100 Industrial Way",
  hqAddressLine2: null,
  hqCity: "Fresno",
  hqState: "CA",
  hqZip: "93727",
  phone: "559-555-0100",
  licenses: [{ jurisdictionName: "California", licenseNumber: "1044321" }],
};

const job: DasJobInput = {
  name: "Clovis High Gym",
  siteAddress: "1400 Fowler Ave, Clovis, CA",
  projectLocation: null,
  awardingBody: "Clovis Unified School District",
  siteCounty: "Fresno",
};

const committee: DasCommitteeInput = {
  name: "Central Valley Drywall/Lathing JATC",
  craftName: "Drywall/Lathers",
  geographicArea: "Fresno, Madera and Kings counties",
  programSponsorNumber: "CA-2001-123",
  addressLine1: "500 Trade Center Dr",
  addressLine2: null,
  city: "Fresno",
  state: "CA",
  postalCode: "93706",
  email: "dispatch@example.org",
  fax: null,
};

const notice = {
  craftName: "Drywall/Lathers",
  election: "APPROVED_TO_TRAIN" as const,
  contractExecutedOn: "2026-09-01",
  estimatedJourneymanHours: 1800,
  estimatedApprenticeHours: 360,
  estimatedStartOn: "2026-10-05",
  estimatedCompletionOn: "2027-02-01",
  contractAmount: 480000,
  projectIdentifier: "CUSD-2026-114",
  sentOn: null,
};

const request = {
  craftName: "Drywall/Lathers",
  apprenticesRequested: 2,
  neededFrom: "2026-09-30",
  neededTo: null,
  requestedOn: null,
  projectIdentifier: "CUSD-2026-114",
};

/** Everything a form is blocking on, minus the signature — which is always
 * blocking and would otherwise drown out the interesting entry. */
function blockingExceptSignature(fields: readonly DasBlockingField[]) {
  return fields.filter((f) => f !== "signature");
}

describe("a complete DAS 140", () => {
  const form = buildDas140({ company, job, committee, notice });

  it("is blocking on the signature and nothing else, because nothing here signs", () => {
    expect(form.blocking).toEqual(["signature"]);
    // `completeExceptSignature` replaced a `sendable` that was a constant
    // false — `signature` is pushed unconditionally, so `sendable` could never
    // be true and nothing but its own test ever read it. This one says the
    // thing a contractor asks: is there anything left for ME to fill in.
    expect(form.completeExceptSignature).toBe(true);
  });

  it("prints what it was given, unchanged", () => {
    expect(form.contractor.name).toBe("Acme Wall & Ceiling");
    expect(form.contractor.licenseNumber).toBe("1044321");
    expect(form.contractor.address).toBe("100 Industrial Way, Fresno, CA 93727");
    expect(form.committee.address).toBe("500 Trade Center Dr, Fresno, CA 93706");
    expect(form.committee.programSponsorNumber).toBe("CA-2001-123");
    expect(form.project.awardingBody).toBe("Clovis Unified School District");
    expect(form.project.identifier).toBe("CUSD-2026-114");
  });

  it("renders every date in UTC, so no reader sees the day before", () => {
    // The dates are formatted through lib/render-date.ts, which states the
    // zone. A bare toLocaleDateString here would read "Aug 31" in California.
    expect(form.contractExecutedOn).toBe("Sep 1, 2026");
    expect(form.estimatedStartOn).toBe("Oct 5, 2026");
    expect(form.estimatedCompletionOn).toBe("Feb 1, 2027");
  });

  it("names the dba alongside the legal name rather than instead of it", () => {
    const form2 = buildDas140({
      company: { ...company, dbaName: "Acme Drywall" },
      job,
      committee,
      notice,
    });
    expect(form2.contractor.name).toBe("Acme Wall & Ceiling (dba Acme Drywall)");
  });
});

describe("what a DAS 140 refuses to invent", () => {
  it("a committee with no address, email or fax", () => {
    const form = buildDas140({
      company,
      job,
      committee: { ...committee, addressLine1: null, city: null, state: null, postalCode: null, email: null, fax: null },
      notice,
    });
    expect(form.committee.address).toBeNull();
    expect(blockingExceptSignature(form.blocking)).toContain("committeeDelivery");
    expect(DAS_BLOCKING_REASON.committeeDelivery).toMatch(/look the committee up on DIR/i);
  });

  it("but an EMAIL alone is enough — the rule names email as a way to send one", () => {
    const form = buildDas140({
      company,
      job,
      committee: { ...committee, addressLine1: null, city: null, state: null, postalCode: null },
      notice,
    });
    expect(blockingExceptSignature(form.blocking)).not.toContain("committeeDelivery");
  });

  it("A COMMITTEE WITH ONLY A CITY — the case that printed as complete", () => {
    // THE DEFECT. `committeeDelivery` tested the JOINED address, and joining
    // [null, null, "Fresno", null] returns "Fresno" — a non-null string, so the
    // form reported a complete address, printed "Fresno" in the address box,
    // and showed no red sentence at all. On a document the state receives, a
    // box that looks filled in is worse than an empty one.
    const form = buildDas140({
      company,
      job,
      committee: {
        ...committee,
        addressLine1: null,
        state: null,
        postalCode: null,
        email: null,
        fax: null,
      },
      notice,
    });
    expect(form.committee.address).toBeNull();
    expect(form.committee.channels).toEqual([]);
    expect(blockingExceptSignature(form.blocking)).toContain("committeeDelivery");
    // And the address box gets the specific sentence, naming what is missing
    // and what IS on file — not a generic "no address".
    expect(form.committee.addressGap).toContain("Fresno");
    expect(form.committee.addressGap).toContain("street line");
    expect(form.completeExceptSignature).toBe(false);
  });

  it("A COMMITTEE WITH ONLY A ZIP — the same defect from the other end", () => {
    const form = buildDas140({
      company,
      job,
      committee: {
        ...committee,
        addressLine1: null,
        city: null,
        state: null,
        email: null,
        fax: null,
      },
      notice,
    });
    expect(form.committee.address).toBeNull();
    expect(blockingExceptSignature(form.blocking)).toContain("committeeDelivery");
    expect(form.committee.addressGap).toContain("93706");
    expect(form.committee.addressGap).toContain("city");
  });

  it("prints no partial address even when the committee IS reachable by email", () => {
    // Reachable, so nothing is blocking — and the postal box still cannot be
    // filled from "Fresno, CA 93706" with no street line. The page prints
    // `addressGap` where the address would have gone.
    const form = buildDas140({
      company,
      job,
      committee: { ...committee, addressLine1: null, email: "dispatch@example.org" },
      notice,
    });
    expect(blockingExceptSignature(form.blocking)).not.toContain("committeeDelivery");
    expect(form.committee.address).toBeNull();
    expect(form.committee.addressGap).toContain("street line");
    expect(form.committee.channels).toEqual(["email"]);
  });

  it("names how the committee can actually be reached, on the block itself", () => {
    const form = buildDas140({ company, job, committee, notice });
    // A whole postal address and an email on the fixture: both, in that order.
    expect(form.committee.channels).toEqual(["post", "email"]);
  });

  it("a program sponsor number it does not have — and does NOT block on one", () => {
    // Nullable because a company frequently does not have it, and whether
    // either form requires it is unverified. So: printed blank, not guessed,
    // and not treated as a hard stop on a claim nobody has checked.
    const form = buildDas140({
      company,
      job,
      committee: { ...committee, programSponsorNumber: null },
      notice,
    });
    expect(form.committee.programSponsorNumber).toBeNull();
    expect(form.blocking).toEqual(["signature"]);
  });

  it("a licence from the wrong state", () => {
    // The dangerous one. An Arizona number in the California licence box on a
    // California public-works form looks entirely filled in.
    const form = buildDas140({
      company: { ...company, licenses: [{ jurisdictionName: "Arizona", licenseNumber: "ROC-99" }] },
      job,
      committee,
      notice,
    });
    expect(form.contractor.licenseNumber).toBeNull();
    expect(blockingExceptSignature(form.blocking)).toContain("contractorLicense");
    // And it names what it DID find, so the sentence is specific.
    expect(form.contractor.licenseFoundInstead).toEqual(["Arizona"]);
  });

  it("and finds the California one when it is not the first row", () => {
    const form = buildDas140({
      company: {
        ...company,
        licenses: [
          { jurisdictionName: "Arizona", licenseNumber: "ROC-99" },
          { jurisdictionName: "California", licenseNumber: "1044321" },
        ],
      },
      job,
      committee,
      notice,
    });
    expect(form.contractor.licenseNumber).toBe("1044321");
  });

  it("the estimated hours — even when the app holds an estimate it could guess from", () => {
    const form = buildDas140({
      company,
      job,
      committee,
      notice: { ...notice, estimatedJourneymanHours: null, estimatedApprenticeHours: null },
    });
    expect(blockingExceptSignature(form.blocking)).toContain("estimatedHours");
    expect(DAS_BLOCKING_REASON.estimatedHours).toMatch(/not ours to make/);
  });

  it("and treats ONE of the two hour figures as no answer at all", () => {
    // Half of a two-part answer reads as a complete one to a reviewer.
    const form = buildDas140({
      company,
      job,
      committee,
      notice: { ...notice, estimatedApprenticeHours: null },
    });
    expect(blockingExceptSignature(form.blocking)).toContain("estimatedHours");
  });

  it("the awarding body, the project location and the project number", () => {
    const form = buildDas140({
      company,
      job: { ...job, awardingBody: null, siteAddress: null, projectLocation: null },
      committee,
      notice: { ...notice, projectIdentifier: null },
    });
    expect(blockingExceptSignature(form.blocking)).toEqual(
      expect.arrayContaining(["awardingBody", "projectLocation", "projectIdentifier"]),
    );
    // "TBD" and "N/A" invalidate the form, per the guidance, so the reason
    // must not suggest writing either.
    expect(DAS_BLOCKING_REASON.projectIdentifier).toMatch(/TBD or N\/A invalidates it/);
  });

  it("falls back to the looser project location before reporting none", () => {
    const form = buildDas140({
      company,
      job: { ...job, siteAddress: null, projectLocation: "Clovis, CA" },
      committee,
      notice,
    });
    expect(form.project.location).toBe("Clovis, CA");
    expect(blockingExceptSignature(form.blocking)).not.toContain("projectLocation");
  });

  it("the contractor's own address", () => {
    const form = buildDas140({
      company: {
        ...company,
        hqAddressLine1: null,
        hqCity: null,
        hqState: null,
        hqZip: null,
      },
      job,
      committee,
      notice,
    });
    expect(form.contractor.address).toBeNull();
    expect(blockingExceptSignature(form.blocking)).toContain("contractorAddress");
  });

  it("prints every blocking field in one fixed order, with no duplicates", () => {
    const form = buildDas140({
      company: { ...company, hqAddressLine1: null, hqCity: null, hqState: null, hqZip: null, licenses: [] },
      job: { ...job, awardingBody: null, siteAddress: null, projectLocation: null },
      committee: { ...committee, addressLine1: null, city: null, state: null, postalCode: null, email: null, fax: null },
      notice: { ...notice, projectIdentifier: null, estimatedJourneymanHours: null, estimatedApprenticeHours: null },
    });
    expect(form.blocking).toEqual([
      "contractorAddress",
      "contractorLicense",
      "committeeDelivery",
      "awardingBody",
      "projectLocation",
      "projectIdentifier",
      "estimatedHours",
      "signature",
    ]);
    expect(new Set(form.blocking).size).toBe(form.blocking.length);
    expect(form.completeExceptSignature).toBe(false);
  });

  it("has a human sentence for every blocking field, not a label", () => {
    for (const [field, reason] of Object.entries(DAS_BLOCKING_REASON)) {
      expect(reason.length, field).toBeGreaterThan(40);
      // A sentence tells the reader what to do about it.
      expect(reason, field).toMatch(/[.!]$|\./);
    }
  });
});

describe("the three DAS 140 boxes", () => {
  it("offers exactly three, numbered as the form numbers them", () => {
    expect(DAS140_ELECTIONS.map((e) => e.box)).toEqual([1, 2, 3]);
  });

  it("labels each one, and throws rather than rendering nothing for a bad value", () => {
    for (const option of DAS140_ELECTIONS) {
      expect(das140ElectionLabel(option.value)).toContain(`Box ${option.box}`);
    }
    // @ts-expect-error — deliberately outside the union
    expect(() => das140ElectionLabel("SOMETHING_ELSE")).toThrow(/No DAS 140 election/);
  });
});

describe("a DAS 142", () => {
  const form = buildDas142({ company, job, committee, request });

  it("carries the latest send day and its caveats together", () => {
    // 2026-09-30 is a Wednesday; three business days back is Friday the 25th.
    expect(form.latestSendDay).toBe("Sep 25, 2026");
    expect(form.leadTimeCaveats).toHaveLength(2);
  });

  it("does not block on estimated hours, which is a DAS 140 field", () => {
    expect(form.blocking).toEqual(["signature"]);
  });

  it("blocks on the committee's contact details, which is what a request is refused on", () => {
    const blind = buildDas142({
      company,
      job,
      committee: {
        ...committee,
        addressLine1: null,
        city: null,
        state: null,
        postalCode: null,
        email: null,
        fax: null,
      },
      request,
    });
    expect(blockingExceptSignature(blind.blocking)).toContain("committeeDelivery");
  });

  it("refuses a city-only committee here too — this is the form with the penalty", () => {
    // There is a documented penalty for sending a DAS 142 to the wrong
    // committee, which is why the same rule has to hold on both forms and why
    // it is one function rather than two copies.
    const cityOnly = buildDas142({
      company,
      job,
      committee: {
        ...committee,
        addressLine1: null,
        state: null,
        postalCode: null,
        email: null,
        fax: null,
      },
      request,
    });
    expect(cityOnly.committee.address).toBeNull();
    expect(blockingExceptSignature(cityOnly.blocking)).toContain("committeeDelivery");
    expect(cityOnly.completeExceptSignature).toBe(false);
  });

  it("is complete except the signature when everything else is there", () => {
    expect(form.completeExceptSignature).toBe(true);
  });

  it("prints the count it was given and never derives one", () => {
    expect(form.apprenticesRequested).toBe(2);
    expect(buildDas142({ company, job, committee, request: { ...request, apprenticesRequested: 1 } })
      .apprenticesRequested).toBe(1);
  });

  it("shows no send date until one is recorded", () => {
    expect(form.requestedOn).toBeNull();
    expect(
      buildDas142({ company, job, committee, request: { ...request, requestedOn: "2026-09-24" } })
        .requestedOn,
    ).toBe("Sep 24, 2026");
  });
});
