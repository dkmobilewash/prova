import { describe as group, expect, it } from "vitest";
import {
  JOB_MEDIA_CLOCK_SKEW_MS,
  JOB_MEDIA_CONTENT_TYPES,
  JOB_MEDIA_MAX_BYTES,
  formatByteSize,
  formatCapturedAt,
  formatCapturedAtInputValue,
  isAllowedJobMediaType,
  isBlobStorageUrl,
  jobMediaClockWarning,
  jobMediaKind,
} from "./job-media";

group("what may be uploaded", () => {
  // The allowlist is handed to the blob store when the token is minted AND
  // re-checked in recordJobMedia. Two enforcement points, one list — the
  // shape LOCATION_TYPES got wrong by keeping a second copy that drifted
  // from its own Prisma enum and silently rejected a live dropdown option.
  it("accepts every type the token allows", () => {
    for (const type of JOB_MEDIA_CONTENT_TYPES) {
      expect(isAllowedJobMediaType(type)).toBe(true);
    }
  });

  it("accepts HEIC, which is what an iPhone actually shoots", () => {
    expect(isAllowedJobMediaType("image/heic")).toBe(true);
  });

  it("refuses video for now, rather than storing something nothing can render", () => {
    expect(isAllowedJobMediaType("video/mp4")).toBe(false);
    expect(isAllowedJobMediaType("video/quicktime")).toBe(false);
  });

  it("refuses a PDF and an executable", () => {
    expect(isAllowedJobMediaType("application/pdf")).toBe(false);
    expect(isAllowedJobMediaType("application/octet-stream")).toBe(false);
  });

  it("is not fooled by a prefix", () => {
    expect(isAllowedJobMediaType("image/svg+xml")).toBe(false);
  });

  it("caps well above a real phone photo and well below a video", () => {
    expect(JOB_MEDIA_MAX_BYTES).toBeGreaterThan(12 * 1024 * 1024);
    expect(JOB_MEDIA_MAX_BYTES).toBeLessThan(100 * 1024 * 1024);
  });

  // The whole point of this feature's upload path. If this ever passes at
  // 1MB, somebody has moved uploads back onto a Server Action and the
  // 1MB body cap (#27) applies again.
  it("is far above the 1MB a Server Action body allows", () => {
    expect(JOB_MEDIA_MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });
});

group("proving a URL came from the blob store", () => {
  const real = "https://abc123xyz.public.blob.vercel-storage.com/photos/site-Xk92.jpg";

  it("accepts a real store URL", () => {
    expect(isBlobStorageUrl(real)).toBe(true);
  });

  it("refuses an arbitrary host", () => {
    expect(isBlobStorageUrl("https://evil.test/photo.jpg")).toBe(false);
  });

  // The two cases a substring or loose-regex check gets wrong, which is
  // the entire reason this parses instead. Both of these CONTAIN the
  // hostname and neither is served by it.
  it("refuses a host that merely mentions the store in its query string", () => {
    expect(
      isBlobStorageUrl("https://evil.test/x.jpg?y=.public.blob.vercel-storage.com"),
    ).toBe(false);
  });

  it("refuses the userinfo trick, where the real host is after the @", () => {
    expect(
      isBlobStorageUrl("https://x.public.blob.vercel-storage.com@evil.test/photo.jpg"),
    ).toBe(false);
  });

  it("refuses a lookalike domain", () => {
    expect(isBlobStorageUrl("https://public.blob.vercel-storage.com.evil.test/x.jpg")).toBe(false);
  });

  it("refuses plain http, so a stored URL is never downgraded", () => {
    expect(isBlobStorageUrl(real.replace("https:", "http:"))).toBe(false);
  });

  it("refuses javascript: and data:, which are not fetches at all", () => {
    expect(isBlobStorageUrl("javascript:alert(1)")).toBe(false);
    expect(isBlobStorageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
  });

  it("refuses nonsense rather than throwing on it", () => {
    expect(isBlobStorageUrl("")).toBe(false);
    expect(isBlobStorageUrl("not a url")).toBe(false);
  });
});

group("what kind of thing a row is", () => {
  it("reads the kind off the content type rather than a stored column", () => {
    expect(jobMediaKind("image/jpeg")).toBe("PHOTO");
    expect(jobMediaKind("image/heic")).toBe("PHOTO");
    expect(jobMediaKind("video/mp4")).toBe("VIDEO");
  });

  // Video cannot be uploaded yet. This asserts the read side is already
  // right for the day it can be, with no backfill for rows written before.
  it("already answers correctly for a video that has not shipped yet", () => {
    expect(jobMediaKind("video/quicktime")).toBe("VIDEO");
  });

  it("does not guess at something it does not recognise", () => {
    expect(jobMediaKind("application/pdf")).toBe("OTHER");
    expect(jobMediaKind("")).toBe("OTHER");
  });
});

group("the two clocks", () => {
  const received = new Date("2026-09-07T18:00:00.000Z");

  it("says nothing when the device and the server roughly agree", () => {
    expect(jobMediaClockWarning(new Date("2026-09-07T17:58:00.000Z"), received)).toBeNull();
  });

  // The normal case this whole feature exists for: a crew shoots on Friday
  // and uploads on Monday. Lateness is never suspicious.
  it("says nothing about photos taken days before they were uploaded", () => {
    expect(jobMediaClockWarning(new Date("2026-09-04T09:00:00.000Z"), received)).toBeNull();
  });

  it("still says nothing a month later", () => {
    expect(jobMediaClockWarning(new Date("2026-08-07T09:00:00.000Z"), received)).toBeNull();
  });

  it("flags a device claiming a capture time in the future", () => {
    const tomorrow = new Date(received.getTime() + 24 * 60 * 60 * 1000);
    expect(jobMediaClockWarning(tomorrow, received)).toMatch(/clock/i);
  });

  it("tolerates a time-zone-sized mistake without crying wolf", () => {
    const fiveHoursAhead = new Date(received.getTime() + 5 * 60 * 60 * 1000);
    expect(jobMediaClockWarning(fiveHoursAhead, received)).toBeNull();
  });

  it("draws the line exactly where the constant says", () => {
    const atLimit = new Date(received.getTime() + JOB_MEDIA_CLOCK_SKEW_MS);
    const pastLimit = new Date(received.getTime() + JOB_MEDIA_CLOCK_SKEW_MS + 1);
    expect(jobMediaClockWarning(atLimit, received)).toBeNull();
    expect(jobMediaClockWarning(pastLimit, received)).not.toBeNull();
  });
});

group("rendering a capture time", () => {
  // capturedAt is an INSTANT, not the UTC-midnight calendar date the rest
  // of this schema stores, so the "render in UTC" rule does not apply and
  // would actively mislead — this is the assertion that says so.
  it("renders in the viewer's zone, not UTC", () => {
    const instant = new Date("2026-09-07T22:14:00.000Z");
    const vegas = formatCapturedAt(instant, "America/Los_Angeles");
    const utc = formatCapturedAt(instant, "UTC");
    expect(vegas).toContain("3:14");
    expect(utc).toContain("10:14");
    expect(vegas).not.toBe(utc);
  });

  it("keeps the time of day, because on a site the hour is the point", () => {
    const label = formatCapturedAt(new Date("2026-09-07T15:00:00.000Z"), "UTC");
    expect(label).toMatch(/Sep/);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });

  it("crosses the date line correctly rather than just shifting the clock", () => {
    // 06:00 UTC on the 8th is still the evening of the 7th in Los Angeles.
    const label = formatCapturedAt(new Date("2026-09-08T06:00:00.000Z"), "America/Los_Angeles");
    expect(label).toContain("Sep 7");
  });
});

group("the value a datetime-local input wants", () => {
  it("is zero-padded, 24-hour, and exactly the shape the input parses", () => {
    const value = formatCapturedAtInputValue(new Date("2026-09-07T22:14:00.000Z"), "UTC");
    expect(value).toBe("2026-09-07T22:14");
  });

  it("is in the viewer's zone, matching the label beside it", () => {
    const instant = new Date("2026-09-07T22:14:00.000Z");
    expect(formatCapturedAtInputValue(instant, "America/Los_Angeles")).toBe("2026-09-07T15:14");
  });

  // h23, not h12 and not h24: midnight must be 00, because "24:14" is not a
  // value the input accepts and would silently render the field blank.
  it("renders midnight as 00 rather than 24", () => {
    const value = formatCapturedAtInputValue(new Date("2026-09-07T00:30:00.000Z"), "UTC");
    expect(value).toBe("2026-09-07T00:30");
  });

  it("round-trips back to the same instant it was rendered from", () => {
    const instant = new Date("2026-09-07T22:14:00.000Z");
    const value = formatCapturedAtInputValue(instant, "UTC");
    // What the browser does on submit, standing in the same zone.
    expect(new Date(`${value}:00.000Z`).toISOString()).toBe(instant.toISOString());
  });
});

group("file sizes a person reads at arm's length", () => {
  it("uses the unit that keeps the number small", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(4096)).toBe("4 KB");
    expect(formatByteSize(4 * 1024 * 1024)).toBe("4.0 MB");
  });

  it("returns nothing rather than NaN for a broken value", () => {
    expect(formatByteSize(Number.NaN)).toBe("");
    expect(formatByteSize(-1)).toBe("");
  });
});
