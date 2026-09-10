import { describe, expect, it } from "vitest";
import { formatSignedDate } from "./signed-date";

describe("formatSignedDate — issue #106 finding 7", () => {
  // 9pm Pacific on Sep 8 is already Sep 9 in UTC. Before this fix the
  // page formatted with no `timeZone`, which on Vercel's server clock
  // (UTC) rendered the LATER date — an evening signature dated a day
  // late, on the one date a dispute turns on.
  const eveningPacific = new Date("2026-09-09T04:30:00Z"); // 9:30pm PDT Sep 8

  it("renders the SIGNER's calendar date, not the UTC one, when a zone is given", () => {
    expect(formatSignedDate(eveningPacific, "America/Los_Angeles")).toBe("Sep 8, 2026");
  });

  it("renders the UTC date when the zone actually is UTC — the honest floor when nothing better is known", () => {
    expect(formatSignedDate(eveningPacific, "UTC")).toBe("Sep 9, 2026");
  });

  it("the same instant renders two different calendar dates depending on zone — the exact bug this fixes", () => {
    const pacific = formatSignedDate(eveningPacific, "America/Los_Angeles");
    const utc = formatSignedDate(eveningPacific, "UTC");
    expect(pacific).not.toBe(utc);
  });

  it("a morning-UTC instant agrees across zones on the same side of midnight", () => {
    const midday = new Date("2026-09-09T18:00:00Z");
    expect(formatSignedDate(midday, "America/Los_Angeles")).toBe("Sep 9, 2026");
    expect(formatSignedDate(midday, "UTC")).toBe("Sep 9, 2026");
  });
});
