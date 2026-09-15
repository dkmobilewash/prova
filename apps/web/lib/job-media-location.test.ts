import { describe as group, expect, it } from "vitest";
import {
  JOB_MEDIA_COORDINATE_DECIMALS,
  JOB_MEDIA_LOCATION_COARSE_METERS,
  JOB_MEDIA_LOCATION_FRESHNESS_MS,
  JOB_MEDIA_LOCATION_TIMEOUT_MS,
  describeCapturedLocation,
  formatAccuracy,
  formatCoordinate,
  locationCoarseNote,
  locationFailureMessage,
  locationIsContemporary,
  locationProblemMessage,
  mapLinkHref,
  parseCapturedLocation,
  requestCaptureLocation,
  roundCoordinate,
  type GeolocationLike,
  type LocationFailure,
} from "./job-media-location";

/**
 * The rules behind "where was this taken".
 *
 * Every one of these is a decision a person can get wrong on a jobsite and
 * that nothing else in the stack would catch: a coordinate is three
 * plausible numbers, and every wrong version of it typechecks, lints and
 * renders. The database's two CHECK constraints are the last line and are
 * exercised in job-media-location.dbtest.ts; these are the first.
 */

group("precision", () => {
  it("rounds to five decimals, and five is the documented number", () => {
    expect(JOB_MEDIA_COORDINATE_DECIMALS).toBe(5);
    // A raw seven-decimal fix, which is what a phone actually reports.
    expect(roundCoordinate(36.1699412)).toBe(36.16994);
    expect(roundCoordinate(-115.1398261)).toBe(-115.13983);
  });

  it("leaves a coordinate that is already coarse exactly as it is", () => {
    // Rounding must not invent digits either. 36.17 stays 36.17 as a NUMBER;
    // the padding to five places is a display decision and lives in
    // formatCoordinate.
    expect(roundCoordinate(36.17)).toBe(36.17);
    expect(roundCoordinate(0)).toBe(0);
  });

  it("does not leave a float artefact behind", () => {
    // The reason rounding is scale-round-unscale rather than toFixed-parse:
    // the result has to be a number a database column takes, and it has to
    // print without a tail of nines.
    expect(String(roundCoordinate(51.5073509))).toBe("51.50735");
  });
});

group("parsing what the wire carries", () => {
  it("reads three empty fields as NO LOCATION, which is not an error", () => {
    // The normal case: a desktop upload, a denied permission, a photo from
    // last week. `null` and not a refusal — the photo is the point.
    expect(parseCapturedLocation({})).toEqual({ ok: true, location: null });
    expect(parseCapturedLocation({ latitude: "", longitude: "", accuracyMeters: "" })).toEqual({
      ok: true,
      location: null,
    });
    expect(parseCapturedLocation({ latitude: "  ", longitude: "  " })).toEqual({
      ok: true,
      location: null,
    });
  });

  it("reads a real fix, rounding it on the way in", () => {
    expect(
      parseCapturedLocation({
        latitude: "36.1699412",
        longitude: "-115.1398261",
        accuracyMeters: "8.531",
      }),
    ).toEqual({
      ok: true,
      // The accuracy is NOT rounded: it is already an estimate, and rounding
      // an estimate is how an error bar quietly becomes a claim.
      location: { latitude: 36.16994, longitude: -115.13983, accuracyMeters: 8.531 },
    });
  });

  it("takes a fix with no accuracy figure at all", () => {
    // A stored row may predate a writer that sent one, and the type says
    // `number | null` for exactly that reason.
    expect(parseCapturedLocation({ latitude: "36.16994", longitude: "-115.13983" })).toEqual({
      ok: true,
      location: { latitude: 36.16994, longitude: -115.13983, accuracyMeters: null },
    });
  });

  it("refuses half a fix rather than silently dropping it", () => {
    // THE DISTINCTION THIS FUNCTION EXISTS FOR. "No location" and "a broken
    // location" must not collapse into each other: if half a fix became
    // null, a writer sending a longitude and no latitude would produce
    // unlocated photos forever and nothing would ever say so.
    expect(parseCapturedLocation({ latitude: "36.16994" })).toEqual({
      ok: false,
      problem: "incomplete",
    });
    expect(parseCapturedLocation({ longitude: "-115.13983" })).toEqual({
      ok: false,
      problem: "incomplete",
    });
    // An accuracy with no coordinates is the same shape of bug: a radius
    // with no centre. The database says the same thing.
    expect(parseCapturedLocation({ accuracyMeters: "8" })).toEqual({
      ok: false,
      problem: "incomplete",
    });
  });

  it("does not read a blank field as the coordinate 0", () => {
    // `Number("")` is 0, and 0,0 is a real place in the Gulf of Guinea. If
    // emptiness were tested after the parse instead of before it, every
    // unlocated upload would be filed 600km off the coast of Ghana.
    const result = parseCapturedLocation({ latitude: "", longitude: "" });
    expect(result).toEqual({ ok: true, location: null });
  });

  it("refuses a coordinate that is not on Earth", () => {
    expect(parseCapturedLocation({ latitude: "91", longitude: "0" })).toEqual({
      ok: false,
      problem: "latitude-out-of-range",
    });
    expect(parseCapturedLocation({ latitude: "-90.1", longitude: "0" })).toEqual({
      ok: false,
      problem: "latitude-out-of-range",
    });
    expect(parseCapturedLocation({ latitude: "0", longitude: "180.5" })).toEqual({
      ok: false,
      problem: "longitude-out-of-range",
    });
    // The poles and the antimeridian are ON Earth and must be accepted —
    // a range check written with `<`/`>` instead of `<=`/`>=` refuses them
    // and nobody would ever notice.
    expect(parseCapturedLocation({ latitude: "90", longitude: "180" }).ok).toBe(true);
    expect(parseCapturedLocation({ latitude: "-90", longitude: "-180" }).ok).toBe(true);
  });

  it("refuses text and infinities", () => {
    expect(parseCapturedLocation({ latitude: "north", longitude: "0" })).toEqual({
      ok: false,
      problem: "not-a-number",
    });
    expect(parseCapturedLocation({ latitude: "Infinity", longitude: "0" })).toEqual({
      ok: false,
      problem: "not-a-number",
    });
    expect(parseCapturedLocation({ latitude: "NaN", longitude: "0" })).toEqual({
      ok: false,
      problem: "not-a-number",
    });
  });

  it("refuses an accuracy of zero or less", () => {
    // The API defines accuracy as a 95%-confidence radius. Zero is a claim
    // of certainty no positioning system makes, and a negative radius is
    // nothing at all.
    expect(
      parseCapturedLocation({ latitude: "36", longitude: "-115", accuracyMeters: "0" }),
    ).toEqual({ ok: false, problem: "accuracy-not-positive" });
    expect(
      parseCapturedLocation({ latitude: "36", longitude: "-115", accuracyMeters: "-5" }),
    ).toEqual({ ok: false, problem: "accuracy-not-positive" });
  });

  it("has a sentence for every problem it can return", () => {
    // A refusal reaching a person as `undefined` is the failure this
    // catches; the list is spelled out rather than derived so adding a
    // member to the union without a message fails to compile here.
    const problems = [
      "incomplete",
      "not-a-number",
      "latitude-out-of-range",
      "longitude-out-of-range",
      "accuracy-not-positive",
    ] as const;
    for (const problem of problems) {
      expect(locationProblemMessage(problem).length).toBeGreaterThan(10);
    }
  });
});

group("whether the phone's position is this capture's position", () => {
  const noon = new Date("2026-09-11T12:00:00.000Z");

  it("accepts a photo taken minutes ago", () => {
    expect(locationIsContemporary(new Date("2026-09-11T11:45:00.000Z"), noon)).toBe(true);
  });

  it("refuses Friday's photos uploaded on Monday", () => {
    // THE CASE THE RULE EXISTS FOR. Without it every one of those photos is
    // recorded as taken at the office, which is worse than no location: it
    // is confidently and specifically wrong on a record whose whole value is
    // being evidence of a place.
    expect(locationIsContemporary(new Date("2026-09-08T15:00:00.000Z"), noon)).toBe(false);
  });

  it("is symmetric, so a device clock running fast does not earn a location", () => {
    const ahead = new Date(noon.getTime() + JOB_MEDIA_LOCATION_FRESHNESS_MS + 1000);
    expect(locationIsContemporary(ahead, noon)).toBe(false);
  });

  it("puts the boundary exactly on the documented hour", () => {
    // An off-by-one in a window is invisible until somebody is standing on
    // it, and the person standing on it is on a roof.
    expect(JOB_MEDIA_LOCATION_FRESHNESS_MS).toBe(60 * 60 * 1000);
    const exactly = new Date(noon.getTime() - JOB_MEDIA_LOCATION_FRESHNESS_MS);
    const justOver = new Date(noon.getTime() - JOB_MEDIA_LOCATION_FRESHNESS_MS - 1);
    expect(locationIsContemporary(exactly, noon)).toBe(true);
    expect(locationIsContemporary(justOver, noon)).toBe(false);
  });

  it("refuses an unparseable capture time rather than treating it as now", () => {
    expect(locationIsContemporary(new Date("not a date"), noon)).toBe(false);
  });
});

group("reading it back", () => {
  it("writes the coordinate at a fixed width", () => {
    // Padded, so a column of cards reads as one kind of measurement. `36.17`
    // beside `36.16994` looks like two different instruments.
    expect(formatCoordinate(36.16994, -115.13983)).toBe("36.16994, -115.13983");
    expect(formatCoordinate(36.17, -115)).toBe("36.17000, -115.00000");
  });

  it("writes metres below a kilometre and kilometres above it", () => {
    expect(formatAccuracy(8)).toBe("±8 m");
    expect(formatAccuracy(8.6)).toBe("±9 m");
    expect(formatAccuracy(999)).toBe("±999 m");
    // 2,431 m is not accurate to the metre in any sense — the figure is
    // itself an estimate — so all four digits would state a precision the
    // estimate does not have.
    expect(formatAccuracy(2431)).toBe("±2.4 km");
  });

  it("returns nothing at all when there is no accuracy figure", () => {
    // Null, never "±?" — an absent error bar is not a value to render.
    expect(formatAccuracy(null)).toBeNull();
    expect(formatAccuracy(0)).toBeNull();
    expect(formatAccuracy(Number.NaN)).toBeNull();
  });

  it("says when a fix is too wide to read as a spot", () => {
    expect(locationCoarseNote(8)).toBeNull();
    expect(locationCoarseNote(JOB_MEDIA_LOCATION_COARSE_METERS)).toBeNull();
    expect(locationCoarseNote(JOB_MEDIA_LOCATION_COARSE_METERS + 1)).toMatch(/area, not the spot/);
    // The case the whole accuracy column exists for: an IP-derived fix, which
    // once stored looks exactly like a GPS one.
    expect(locationCoarseNote(2000)).toMatch(/area, not the spot/);
  });

  it("says nothing when there is no accuracy to judge", () => {
    // A row with no error bar gets no note. Warning about a number that is
    // absent would be a warning nobody can act on.
    expect(locationCoarseNote(null)).toBeNull();
  });

  it("builds a map link with no library, no key and no script", () => {
    const href = mapLinkHref(36.16994, -115.13983);
    expect(href).toBe(
      "https://www.openstreetmap.org/?mlat=36.16994&mlon=-115.13983#map=18/36.16994/-115.13983",
    );
    // Nothing about this is a runtime dependency: it is a string in an href.
    expect(href.startsWith("https://")).toBe(true);
  });

  it("projects a stored row into exactly what a card renders", () => {
    expect(
      describeCapturedLocation({
        capturedLatitude: 36.16994,
        capturedLongitude: -115.13983,
        capturedAccuracyMeters: 8,
      }),
    ).toEqual({
      coordinateLabel: "36.16994, -115.13983",
      accuracyLabel: "±8 m",
      coarseNote: null,
      mapHref: "https://www.openstreetmap.org/?mlat=36.16994&mlon=-115.13983#map=18/36.16994/-115.13983",
    });
  });

  it("projects an unlocated row to null, which is most rows", () => {
    // The card renders nothing for null. This must not be an exception path
    // or a placeholder: a photo without a location is an ordinary photo.
    expect(
      describeCapturedLocation({
        capturedLatitude: null,
        capturedLongitude: null,
        capturedAccuracyMeters: null,
      }),
    ).toBeNull();
    // Half a row cannot exist (the database refuses it), and a read path is
    // still not where anybody should discover that.
    expect(
      describeCapturedLocation({
        capturedLatitude: 36.16994,
        capturedLongitude: null,
        capturedAccuracyMeters: null,
      }),
    ).toBeNull();
  });
});

group("asking the browser, and every way it says no", () => {
  const secure = { secureContext: true };
  const fix = { coords: { latitude: 36.1699412, longitude: -115.1398261, accuracy: 8 } };

  /** A geolocation that succeeds. */
  const granted: GeolocationLike = {
    getCurrentPosition: (onSuccess) => onSuccess(fix),
  };
  /** One that fails with a given code. */
  const fails = (code: number): GeolocationLike => ({
    getCurrentPosition: (_onSuccess, onError) => onError?.({ code }),
  });
  /** THE ONE A REAL BROWSER PRODUCES AND NOTHING ELSE CAN TEST: a permission
   *  prompt that is dismissed rather than answered. Neither callback ever
   *  fires, and the API's own `timeout` option is specified as excluding the
   *  time spent obtaining permission, so it never starts either. */
  const dismissed: GeolocationLike = { getCurrentPosition: () => {} };

  it("returns the rounded fix when permission is granted", async () => {
    expect(await requestCaptureLocation(granted, secure)).toEqual({
      ok: true,
      location: { latitude: 36.16994, longitude: -115.13983, accuracyMeters: 8 },
    });
  });

  it("says INSECURE CONTEXT before it asks anybody anything", async () => {
    // Checked first on purpose. On http some browsers delete the API and
    // others keep it and answer PERMISSION_DENIED — which would tell the
    // person to change a permission that is not the problem. The page's own
    // protocol is knowable without a prompt.
    expect(await requestCaptureLocation(granted, { secureContext: false })).toEqual({
      ok: false,
      failure: "insecure-context",
    });
  });

  it("says UNSUPPORTED when the browser has no geolocation at all", async () => {
    expect(await requestCaptureLocation(undefined, secure)).toEqual({
      ok: false,
      failure: "unsupported",
    });
    expect(await requestCaptureLocation({} as GeolocationLike, secure)).toEqual({
      ok: false,
      failure: "unsupported",
    });
  });

  it("maps each error code to its own answer", async () => {
    expect(await requestCaptureLocation(fails(1), secure)).toEqual({
      ok: false,
      failure: "denied",
    });
    expect(await requestCaptureLocation(fails(2), secure)).toEqual({
      ok: false,
      failure: "unavailable",
    });
    expect(await requestCaptureLocation(fails(3), secure)).toEqual({
      ok: false,
      failure: "timeout",
    });
    // A code this build does not know is still a refusal.
    expect(await requestCaptureLocation(fails(99), secure)).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });

  it("gives up on its OWN clock when the prompt is dismissed and nothing ever calls back", async () => {
    // THE BRANCH THAT WOULD OTHERWISE HANG THE UPLOAD FOREVER, and the whole
    // reason there are two timers. The fake never calls either callback,
    // exactly like a dismissed permission prompt.
    let fired: (() => void) | null = null;
    const attempt = requestCaptureLocation(dismissed, {
      secureContext: true,
      timeoutMs: 12_000,
      setTimer: (fn) => {
        fired = fn;
        return 1;
      },
      clearTimer: () => {},
    });
    expect(fired).not.toBeNull();
    (fired as unknown as () => void)();
    expect(await attempt).toEqual({ ok: false, failure: "timeout" });
  });

  it("still answers when getCurrentPosition throws synchronously", async () => {
    // Not specified to throw, and a hardened browser does it anyway. An
    // exception escaping here would reject a promise this function promises
    // never to reject — which means an upload that dies for want of a
    // coordinate.
    const throws: GeolocationLike = {
      getCurrentPosition: () => {
        throw new Error("blocked by policy");
      },
    };
    expect(await requestCaptureLocation(throws, secure)).toEqual({
      ok: false,
      failure: "unsupported",
    });
  });

  it("refuses a fix the platform reported as something other than numbers", async () => {
    const nonsense = {
      getCurrentPosition: (onSuccess: (p: unknown) => void) =>
        onSuccess({ coords: { latitude: "36" as unknown as number, longitude: 1 } }),
    } as unknown as GeolocationLike;
    expect(await requestCaptureLocation(nonsense, secure)).toEqual({
      ok: false,
      failure: "unusable",
    });
  });

  it("refuses a fix outside the coordinate ranges rather than uploading it", async () => {
    // The same parser the server uses, called here, so an impossible
    // coordinate is caught before the bytes move rather than by a CHECK
    // constraint after them.
    const impossible: GeolocationLike = {
      getCurrentPosition: (onSuccess) => onSuccess({ coords: { latitude: 91, longitude: 0 } }),
    };
    expect(await requestCaptureLocation(impossible, secure)).toEqual({
      ok: false,
      failure: "unusable",
    });
  });

  it("takes a fix with no accuracy at all, because accuracy is optional", async () => {
    const noAccuracy: GeolocationLike = {
      getCurrentPosition: (onSuccess) => onSuccess({ coords: { latitude: 36.5, longitude: -115.5 } }),
    };
    expect(await requestCaptureLocation(noAccuracy, secure)).toEqual({
      ok: true,
      location: { latitude: 36.5, longitude: -115.5, accuracyMeters: null },
    });
  });

  it("answers once, even if a late success arrives after the timeout", async () => {
    // A real browser can call back after we have given up. The caller has
    // already gone ahead with the upload by then, and a second resolution
    // would be a second answer to a question nobody is still asking.
    let late: ((p: { coords: { latitude: number; longitude: number } }) => void) | null = null;
    let timerFn: (() => void) | null = null;
    const slow: GeolocationLike = {
      getCurrentPosition: (onSuccess) => {
        late = onSuccess;
      },
    };
    const attempt = requestCaptureLocation(slow, {
      secureContext: true,
      setTimer: (fn) => {
        timerFn = fn;
        return 1;
      },
      clearTimer: () => {},
    });
    (timerFn as unknown as () => void)();
    (late as unknown as (p: { coords: { latitude: number; longitude: number } }) => void)({
      coords: { latitude: 1, longitude: 2 },
    });
    expect(await attempt).toEqual({ ok: false, failure: "timeout" });
  });

  it("has a sentence for every failure, including the one the API never sees", () => {
    const failures: LocationFailure[] = [
      "unsupported",
      "insecure-context",
      "denied",
      "unavailable",
      "timeout",
      "unusable",
      // Not a failure of the API at all — the API was never asked, because
      // the file is not from around now.
      "stale-capture",
    ];
    for (const failure of failures) {
      expect(locationFailureMessage(failure).length).toBeGreaterThan(20);
    }
    // Each one says something different. A single generic sentence would be
    // the same as having no branches at all.
    expect(new Set(failures.map(locationFailureMessage)).size).toBe(failures.length);
  });

  it("keeps the documented wall-clock budget", () => {
    expect(JOB_MEDIA_LOCATION_TIMEOUT_MS).toBe(12_000);
  });
});
