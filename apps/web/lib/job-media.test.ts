import { describe as group, expect, it } from "vitest";
import {
  JOB_MEDIA_CLOCK_SKEW_MS,
  JOB_MEDIA_AUDIO_MAX_BYTES,
  JOB_MEDIA_CONTENT_TYPES,
  JOB_MEDIA_PHOTO_MAX_BYTES,
  JOB_MEDIA_VIDEO_MAX_BYTES,
  formatByteSize,
  formatCapturedAt,
  formatCapturedAtInputValue,
  isAllowedJobMediaType,
  isBlobStorageUrl,
  isJobMediaBlobUrl,
  isJobMediaPathname,
  isOurBlobStoreUrl,
  blobStoreId,
  jobMediaClockWarning,
  jobMediaFileName,
  jobMediaKind,
  jobMediaMaxBytes,
  jobMediaPlaybackWarning,
  jobMediaUploadErrorMessage,
  jobMediaUploadPathname,
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

  // This test used to assert the OPPOSITE — "refuses video for now" — and
  // it is inverted rather than deleted so the change of policy is legible
  // in the diff instead of looking like coverage quietly disappearing.
  it("accepts what a phone's own camera and voice recorder produce", () => {
    expect(isAllowedJobMediaType("video/mp4")).toBe(true);
    // The one nobody expects: an iPhone records .mov and does NOT
    // transcode it on the way through a file input, the way it does a HEIC
    // still. Refusing this would mean the feature worked on Android and
    // failed on the device most of this ICP carries.
    expect(isAllowedJobMediaType("video/quicktime")).toBe(true);
    // iOS Voice Memos exports .m4a; Chrome's recorder emits webm.
    expect(isAllowedJobMediaType("audio/mp4")).toBe(true);
    expect(isAllowedJobMediaType("audio/webm")).toBe(true);
  });

  it("refuses a PDF and an executable", () => {
    expect(isAllowedJobMediaType("application/pdf")).toBe(false);
    expect(isAllowedJobMediaType("application/octet-stream")).toBe(false);
  });

  it("is not fooled by a prefix", () => {
    expect(isAllowedJobMediaType("image/svg+xml")).toBe(false);
  });

  it("caps a photo well above a real phone photo and well below a video", () => {
    expect(JOB_MEDIA_PHOTO_MAX_BYTES).toBeGreaterThan(12 * 1024 * 1024);
    expect(JOB_MEDIA_PHOTO_MAX_BYTES).toBeLessThan(100 * 1024 * 1024);
  });

  // The property that actually matters, rather than the numbers: a video
  // may be bigger than a photo, and neither cap may be so large that a
  // mis-picked file is a several-hundred-megabyte upload on a hotspot.
  it("gives video more room than a photo, and still bounds it", () => {
    expect(JOB_MEDIA_VIDEO_MAX_BYTES).toBeGreaterThan(JOB_MEDIA_PHOTO_MAX_BYTES);
    expect(JOB_MEDIA_VIDEO_MAX_BYTES).toBeLessThanOrEqual(512 * 1024 * 1024);
  });

  // THE CAP MUST FOLLOW THE KIND, because it is minted into the upload
  // token per type. A photo silently earning the video ceiling is how a
  // 200MB "photo" gets into the store.
  it("hands each kind its own cap, and refuses to cap what it does not accept", () => {
    expect(jobMediaMaxBytes("image/jpeg")).toBe(JOB_MEDIA_PHOTO_MAX_BYTES);
    expect(jobMediaMaxBytes("video/mp4")).toBe(JOB_MEDIA_VIDEO_MAX_BYTES);
    expect(jobMediaMaxBytes("audio/mp4")).toBe(JOB_MEDIA_AUDIO_MAX_BYTES);
    expect(jobMediaMaxBytes("application/pdf")).toBeNull();
  });

  // The whole point of this feature's upload path. If this ever passes at
  // 1MB, somebody has moved uploads back onto a Server Action and the
  // 1MB body cap (#27) applies again.
  it("is far above the 1MB a Server Action body allows", () => {
    expect(JOB_MEDIA_PHOTO_MAX_BYTES).toBeGreaterThan(1024 * 1024);
    expect(JOB_MEDIA_VIDEO_MAX_BYTES).toBeGreaterThan(1024 * 1024);
    expect(JOB_MEDIA_AUDIO_MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });
});

group("which kind a stored capture is", () => {
  // The card, both galleries and the portal all branch on this, and none
  // of them stores it — the model comment on `contentType` refuses a
  // `kind` column precisely because it could disagree with the type it
  // came from.
  it("names each kind from its content type", () => {
    expect(jobMediaKind("image/heic")).toBe("photo");
    expect(jobMediaKind("video/quicktime")).toBe("video");
    expect(jobMediaKind("audio/mpeg")).toBe("audio");
  });

  it("is null for anything not accepted, which is what makes it the allowlist", () => {
    expect(jobMediaKind("application/pdf")).toBeNull();
    expect(jobMediaKind("")).toBeNull();
    // Not fooled by a prefix, the same way isAllowedJobMediaType is not:
    // "video/mp4-fake" is not video and must not earn the video cap.
    expect(jobMediaKind("video/mp4-fake")).toBeNull();
  });

  // Every accepted type must have a kind and a cap. Without this a type
  // added to one list and not the others is a token that cannot be minted
  // — which fails closed, but fails at the roof rather than in CI.
  it("gives every accepted type both a kind and a cap", () => {
    for (const type of JOB_MEDIA_CONTENT_TYPES) {
      expect(jobMediaKind(type)).not.toBeNull();
      expect(jobMediaMaxBytes(type)).toBeGreaterThan(0);
    }
  });
});

group("warning about what will not play", () => {
  // Not a refusal — the file is the crew's own phone's output and is worth
  // keeping either way. The point is that the person deciding to show it
  // to a GC is told BEFORE they decide.
  it("flags the formats a common browser cannot play", () => {
    expect(jobMediaPlaybackWarning("video/quicktime")).toContain("Chrome");
    expect(jobMediaPlaybackWarning("audio/webm")).toContain("Safari");
    expect(jobMediaPlaybackWarning("audio/ogg")).toContain("Safari");
  });

  it("says nothing about the formats that play everywhere", () => {
    expect(jobMediaPlaybackWarning("image/jpeg")).toBeNull();
    expect(jobMediaPlaybackWarning("video/mp4")).toBeNull();
    expect(jobMediaPlaybackWarning("audio/mp4")).toBeNull();
  });
});

group("proving the store is OURS, not merely a Vercel one", () => {
  // The gap both other checks leave open: they are about the SHAPE of a
  // URL — a blob host, a path under this job — and anyone can create a
  // Vercel blob store and put any path they like in it. `recordJobMedia`
  // is a Server Action, so a caller who knows a job id can post directly.
  const OURS = "abc123xyz";
  const ENV = { BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${OURS}_s3cr3tPart` };
  const url = (store: string) =>
    `https://${store}.public.blob.vercel-storage.com/job-media/job_1/site-Xk92.jpg`;

  it("reads the store id out of a read-write token", () => {
    // vercel_blob_rw_<storeId>_<secret> — the SDK's own parse is
    // token.split("_")[3] (chunk-YYMLUMXS.js:120).
    expect(blobStoreId(ENV)).toBe(OURS);
  });

  it("reads it from BLOB_STORE_ID under OIDC, where no token exists", () => {
    // Not hypothetical: resolveBlobAuth (:161-205) takes this path when
    // there is no read-write token. Deriving only from the token would
    // fail CLOSED on such a deployment and stop every upload.
    expect(blobStoreId({ BLOB_STORE_ID: OURS })).toBe(OURS);
  });

  it("strips the store_ prefix BLOB_STORE_ID may carry, as normalizeStoreId does", () => {
    expect(blobStoreId({ BLOB_STORE_ID: `store_${OURS}` })).toBe(OURS);
  });

  it("prefers the token when both are set, matching resolveBlobAuth's order", () => {
    expect(blobStoreId({ ...ENV, BLOB_STORE_ID: "someotherstore" })).toBe(OURS);
  });

  it("derives nothing from a token that is not a read-write token", () => {
    // Fewer than five segments cannot be vercel_blob_rw_<id>_<secret>.
    expect(blobStoreId({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_onlyfour" })).toBeNull();
    expect(blobStoreId({ BLOB_READ_WRITE_TOKEN: "" })).toBeNull();
    expect(blobStoreId({})).toBeNull();
  });

  it("accepts a URL from our own store", () => {
    expect(isOurBlobStoreUrl(url(OURS), ENV)).toBe(true);
  });

  it("REFUSES a well-formed URL from somebody else's Vercel store", () => {
    // The whole point. This URL passes isBlobStorageUrl and, for job_1,
    // isJobMediaBlobUrl too — it is a real blob host and a correct path.
    expect(isBlobStorageUrl(url("attackerstore"))).toBe(true);
    expect(isJobMediaBlobUrl(url("attackerstore"), "job_1")).toBe(true);
    expect(isOurBlobStoreUrl(url("attackerstore"), ENV)).toBe(false);
  });

  it("refuses a store id that merely starts with ours", () => {
    expect(isOurBlobStoreUrl(url(`${OURS}evil`), ENV)).toBe(false);
  });

  it("refuses ours pushed down into a longer host", () => {
    expect(isOurBlobStoreUrl(url(`evil.${OURS}`), ENV)).toBe(false);
    expect(isOurBlobStoreUrl(url(`${OURS}.evil`), ENV)).toBe(false);
  });

  it("compares case-insensitively, because URL lowercases a hostname", () => {
    expect(isOurBlobStoreUrl(url(OURS), { BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${OURS.toUpperCase()}_x_y` })).toBe(
      true,
    );
  });

  it("FAILS CLOSED with no credentials at all", () => {
    // Safe rather than merely cautious: without credentials the upload
    // route cannot mint a token, so no legitimate URL exists to record.
    expect(isOurBlobStoreUrl(url(OURS), {})).toBe(false);
  });

  it("still refuses everything isBlobStorageUrl refuses", () => {
    expect(isOurBlobStoreUrl("https://evil.test/photo.jpg", ENV)).toBe(false);
    expect(isOurBlobStoreUrl(`http://${OURS}.public.blob.vercel-storage.com/x.jpg`, ENV)).toBe(false);
    expect(isOurBlobStoreUrl(`https://${OURS}.public.blob.vercel-storage.com@evil.test/x.jpg`, ENV)).toBe(false);
    expect(isOurBlobStoreUrl("not a url", ENV)).toBe(false);
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

// The cross-tenant hole these close: one blob store serves every tenant,
// so "this URL is from the blob store" says nothing about WHOSE file it
// is. A signed-in user of company A could record company B's photo as a
// row of their own and then delete it, and `del()` would destroy B's file
// while every row-level companyId check passed. The pathname is what
// carries the tenancy now, and these are the adversarial cases.
group("binding a blob to the job that may have it", () => {
  const JOB = "cmjobalpha000001";
  const OTHER = "cmjobbravo000002";
  const host = "https://abc123xyz.public.blob.vercel-storage.com";
  const mine = `job-media/${JOB}/site-photo-Xk92zz.jpg`;

  it("builds the pathname the three enforcement points share", () => {
    expect(jobMediaUploadPathname(JOB, "IMG_0042.HEIC")).toBe(`job-media/${JOB}/IMG_0042.HEIC`);
  });

  // A `/` in the id would build a prefix that scopes nothing at all, so it
  // refuses to build one rather than producing a path that looks scoped.
  it("refuses an id this app could not have issued, on both sides", () => {
    expect(jobMediaUploadPathname("../other", "x.jpg")).toBeNull();
    expect(jobMediaUploadPathname("job/../other", "x.jpg")).toBeNull();
    expect(jobMediaUploadPathname("", "x.jpg")).toBeNull();
    expect(isJobMediaPathname("job-media/../other/x.jpg", "../other")).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/${mine}`, "")).toBe(false);
  });

  it("accepts this job's own upload, suffix and all", () => {
    expect(isJobMediaPathname(mine, JOB)).toBe(true);
    expect(isJobMediaBlobUrl(`${host}/${mine}`, JOB)).toBe(true);
  });

  // THE BUG ITSELF: another company's photo, presented to recordJobMedia
  // by a caller who does own the job named beside it.
  it("refuses another job's blob", () => {
    expect(isJobMediaPathname(`job-media/${OTHER}/theirs.jpg`, JOB)).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/job-media/${OTHER}/theirs.jpg`, JOB)).toBe(false);
  });

  it("refuses a blob at the store root, which is where every upload used to land", () => {
    expect(isJobMediaPathname("site-photo-Xk92zz.jpg", JOB)).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/site-photo-Xk92zz.jpg`, JOB)).toBe(false);
  });

  it("refuses the other four uploaders' folders", () => {
    expect(isJobMediaBlobUrl(`${host}/compliance/cmp_alpha/COI-r4nd0m1.pdf`, JOB)).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/contracts/${JOB}/subcontract-r4.pdf`, JOB)).toBe(false);
  });

  // The trailing "/" in the prefix is the whole of this. Without it, job
  // "cmjobalpha000001" matches a folder belonging to a job whose id merely
  // starts with those characters.
  it("refuses a job id that is only a PREFIX of another job id", () => {
    const longer = `${JOB}9`;
    expect(isJobMediaPathname(`job-media/${longer}/theirs.jpg`, JOB)).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/job-media/${longer}/theirs.jpg`, JOB)).toBe(false);
  });

  it("refuses a folder whose NAME merely starts with the right characters", () => {
    expect(isJobMediaPathname(`job-media-public/${JOB}/x.jpg`, JOB)).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/job-media-public/${JOB}/x.jpg`, JOB)).toBe(false);
  });

  it("refuses traversal back out of this job's folder", () => {
    expect(isJobMediaPathname(`job-media/${JOB}/../${OTHER}/theirs.jpg`, JOB)).toBe(false);
    expect(isJobMediaPathname(`job-media/${JOB}/..`, JOB)).toBe(false);
    // `new URL` normalises the literal form away, so this one is refused
    // by the prefix no longer matching rather than by the ".." rule —
    // either way it must not pass.
    expect(isJobMediaBlobUrl(`${host}/job-media/${JOB}/../${OTHER}/theirs.jpg`, JOB)).toBe(false);
  });

  it("refuses percent-encoded traversal, which `new URL` does NOT normalise", () => {
    expect(isJobMediaBlobUrl(`${host}/job-media/${JOB}/%2e%2e%2f${OTHER}/theirs.jpg`, JOB)).toBe(
      false,
    );
    expect(isJobMediaBlobUrl(`${host}/job-media/${JOB}/sub%2Fdeeper.jpg`, JOB)).toBe(false);
  });

  it("refuses a deeper folder under this job, because the remainder is one segment", () => {
    expect(isJobMediaPathname(`job-media/${JOB}/nested/photo.jpg`, JOB)).toBe(false);
  });

  it("refuses the folder itself, with nothing in it", () => {
    expect(isJobMediaPathname(`job-media/${JOB}/`, JOB)).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/job-media/${JOB}/`, JOB)).toBe(false);
  });

  // One leading slash is stripped, not all of them: "//job-media/…" is a
  // different store key and must not be collapsed into the good one.
  it("refuses a doubled leading slash", () => {
    expect(isJobMediaBlobUrl(`${host}//job-media/${JOB}/x.jpg`, JOB)).toBe(false);
  });

  // Everything the host check already refused stays refused when the
  // prefix is right — the two checks are ANDed, not alternatives.
  it("still refuses a non-store host carrying a perfectly good prefix", () => {
    expect(isJobMediaBlobUrl(`https://evil.test/${mine}`, JOB)).toBe(false);
    expect(isJobMediaBlobUrl(`https://x.public.blob.vercel-storage.com@evil.test/${mine}`, JOB)).toBe(
      false,
    );
    expect(isJobMediaBlobUrl(`http://abc.public.blob.vercel-storage.com/${mine}`, JOB)).toBe(false);
    expect(isJobMediaBlobUrl("not a url", JOB)).toBe(false);
  });

  it("refuses everything when the job id is not one this app issued", () => {
    expect(isJobMediaPathname(mine, "../other")).toBe(false);
    expect(isJobMediaBlobUrl(`${host}/${mine}`, "")).toBe(false);
  });
});

group("the filename a person's phone chose", () => {
  it("keeps an ordinary photo name intact", () => {
    expect(jobMediaFileName("IMG_0042.HEIC")).toBe("IMG_0042.HEIC");
    expect(jobMediaFileName("west-wall.2.jpg")).toBe("west-wall.2.jpg");
  });

  // Nothing in the name may change the SHAPE of the path it is appended
  // to — that is the whole job of this function.
  it("cannot introduce a separator or a traversal", () => {
    expect(jobMediaFileName("../../etc/passwd")).not.toContain("/");
    expect(jobMediaFileName("../../etc/passwd")).not.toContain("..");
    expect(jobMediaFileName("a/b/c.jpg")).toBe("c.jpg");
    expect(jobMediaFileName("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(jobMediaFileName("IMG..0042.jpg")).toBe("IMG.0042.jpg");
  });

  it("survives a name made entirely of things it strips", () => {
    expect(jobMediaFileName("...")).toBe("photo");
    expect(jobMediaFileName("")).toBe("photo");
    expect(jobMediaFileName("///")).toBe("photo");
  });

  it("still produces a pathname this job accepts, whatever the name was", () => {
    const jobId = "cmjobalpha000001";
    for (const name of ["../../escape.jpg", "site photo (1).JPG", "…….png", "a".repeat(400) + ".jpg"]) {
      const pathname = jobMediaUploadPathname(jobId, name);
      expect(pathname).not.toBeNull();
      expect(isJobMediaPathname(pathname as string, jobId)).toBe(true);
    }
  });
});

group("what the person is told when storage refuses", () => {
  // @vercel/blob/client throws away the body of any non-2xx response from
  // the token route (dist/client.js:398-400), so the route's own sentence
  // never arrives. Saying so beats inventing a reason.
  it("does not repeat the SDK's own phrasing for a refusal it did not explain", () => {
    const message = jobMediaUploadErrorMessage(new Error("Failed to  retrieve the client token"));
    expect(message).not.toMatch(/retrieve the client token/i);
    expect(message).toMatch(/does not pass on the reason/i);
  });

  it("passes through a real error that does say something", () => {
    expect(jobMediaUploadErrorMessage(new Error("Network request failed"))).toBe(
      "Network request failed",
    );
  });

  it("says something rather than nothing for a thrown non-Error", () => {
    expect(jobMediaUploadErrorMessage("boom")).toBe("Upload failed");
    expect(jobMediaUploadErrorMessage(new Error(""))).toBe("Upload failed");
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
