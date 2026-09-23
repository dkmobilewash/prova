import { describe, expect, it } from "vitest";
import { calendarDayFromForm, determinationFactsFromForm, jobComplianceFactsFromForm } from "./determination-facts";

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("calendarDayFromForm — an entered day, stored at UTC midnight, or a refusal naming the field", () => {
  it("blank is null, not today", () => {
    expect(calendarDayFromForm(form({ d: "" }), "d", "issue date")).toEqual({ ok: true, value: null });
    expect(calendarDayFromForm(form({}), "d", "issue date")).toEqual({ ok: true, value: null });
  });

  it("a real day lands at UTC midnight", () => {
    const parsed = calendarDayFromForm(form({ d: "2026-08-10" }), "d", "issue date");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("30 February is refused rather than rolled into March", () => {
    expect(calendarDayFromForm(form({ d: "2026-02-30" }), "d", "issue date")).toEqual({
      ok: false,
      error: "The issue date isn't a valid date.",
    });
  });

  it("free text is refused", () => {
    expect(calendarDayFromForm(form({ d: "next Tuesday" }), "d", "expiration date")).toEqual({
      ok: false,
      error: "The expiration date isn't a valid date.",
    });
  });
});

describe("determinationFactsFromForm", () => {
  it("all four facts, as entered", () => {
    const parsed = determinationFactsFromForm(
      form({ determinationRef: " SC-023-31-2, 2026-1 ", issuedOn: "2026-02-22", expiresOn: "2026-06-30", expirationMarker: "DOUBLE" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.determinationRef).toBe("SC-023-31-2, 2026-1");
    expect(parsed.value.issuedOn?.toISOString()).toBe("2026-02-22T00:00:00.000Z");
    expect(parsed.value.expiresOn?.toISOString()).toBe("2026-06-30T00:00:00.000Z");
    expect(parsed.value.expirationMarker).toBe("DOUBLE");
  });

  it("everything blank is every field null — an existing row edited with nothing typed stays unchecked", () => {
    expect(determinationFactsFromForm(form({}))).toEqual({
      ok: true,
      value: { determinationRef: null, issuedOn: null, expiresOn: null, expirationMarker: null },
    });
  });

  it("an expiration before the issue date is refused in a sentence", () => {
    expect(determinationFactsFromForm(form({ issuedOn: "2026-08-22", expiresOn: "2026-06-30" }))).toEqual({
      ok: false,
      error: "The expiration date is before the issue date — check the document.",
    });
  });

  it("a marker outside the three is refused, not stored", () => {
    expect(determinationFactsFromForm(form({ expirationMarker: "TRIPLE" }))).toEqual({
      ok: false,
      error: "Choose one of the asterisk options for the expiration date.",
    });
  });
});

describe("jobComplianceFactsFromForm", () => {
  it("public works yes / no / not recorded are three different answers", () => {
    const yes = jobComplianceFactsFromForm(form({ publicWorks: "yes" }));
    const no = jobComplianceFactsFromForm(form({ publicWorks: "no" }));
    const blank = jobComplianceFactsFromForm(form({ publicWorks: "" }));
    expect(yes.ok && yes.value.publicWorks).toBe(true);
    expect(no.ok && no.value.publicWorks).toBe(false);
    expect(blank.ok && blank.value.publicWorks).toBe(null);
  });

  it("the bid-advertisement date is entered, and a bad one is refused by name", () => {
    const parsed = jobComplianceFactsFromForm(
      form({ siteCounty: "Los Angeles", publicWorks: "yes", bidAdvertisedOn: "2026-08-10", awardingBody: "Long Beach USD" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value).toMatchObject({ siteCounty: "Los Angeles", publicWorks: true, awardingBody: "Long Beach USD" });
    expect(parsed.value.bidAdvertisedOn?.toISOString()).toBe("2026-08-10T00:00:00.000Z");

    expect(jobComplianceFactsFromForm(form({ bidAdvertisedOn: "10/08/2026" }))).toEqual({
      ok: false,
      error: "The bid-advertisement date isn't a valid date.",
    });
  });

  it("an unknown public-works value is refused", () => {
    expect(jobComplianceFactsFromForm(form({ publicWorks: "maybe" }))).toEqual({
      ok: false,
      error: "Choose whether this job is public works, or leave it as not recorded.",
    });
  });
});
