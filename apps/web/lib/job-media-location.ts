/**
 * WHERE a site capture was taken: asking the browser for it, judging what
 * comes back, and writing it down for a person.
 *
 * Pure and session-free, the same split `lib/job-media.ts` and
 * `lib/job-media-tags.ts` already make against their query modules and their
 * actions. Every rule in this feature is decidable from numbers, so every
 * rule is here and both writers — `JobMediaCapture` in the browser and
 * `recordJobMedia` on the server — import it rather than restating it. A
 * second copy of a coordinate range is how `LOCATION_TYPES` came to disagree
 * with its own Prisma enum and silently refused a dropdown option the UI
 * offered (CLAUDE.md).
 *
 * `requestCaptureLocation` at the bottom is the one function here that is
 * not pure, and it TAKES THE `Geolocation` OBJECT AS AN ARGUMENT rather than
 * reaching for `navigator` — the same shape `formatCapturedAt` uses for the
 * viewer's time zone. That is what makes the branches this feature actually
 * has to survive (denied, dismissed, no hardware, insecure page, timeout)
 * testable at all: they are impossible to produce from a real browser in a
 * test and trivial to produce from a fake.
 */

/* ------------------------------------------------------------------ *
 * What is stored
 * ------------------------------------------------------------------ */

/**
 * FIVE DECIMAL PLACES, and this number is the whole precision policy.
 *
 * 0.00001° is about 1.1 m of latitude anywhere, and about 0.9 m of longitude
 * at 40° north. Nothing a phone produces is that good: 3-5 m is a clear-sky
 * GPS fix, and inside a steel building with the sky in one direction it is
 * tens of metres. So five decimals throws away nothing that was ever
 * measured.
 *
 * What it throws away is the sixth and seventh, which a phone reports and
 * which locate a person to centimetres. Keeping them would not make the
 * answer better — the accuracy radius stored beside it is metres wide — it
 * would only make a number that LOOKS like a survey point out of one that is
 * a phone's guess. This app writes down a crew member's position; the
 * smallest honest version of that is the one to keep.
 */
export const JOB_MEDIA_COORDINATE_DECIMALS = 5;

/** Rounded to the stored precision. Applied ONCE, on the way in, so the
 * stored value is the displayed value — a second rounding at read time is a
 * second rule that can drift from this one. */
export function roundCoordinate(value: number): number {
  const factor = 10 ** JOB_MEDIA_COORDINATE_DECIMALS;
  // `Math.round` on a value scaled by a power of ten, rather than
  // `toFixed` + `Number`: toFixed returns a string and the parse back is an
  // extra step that can only lose. Negative values round the same way here
  // (round-half-up in magnitude terms differs for exact .5 cases, which no
  // fix from a device ever lands on) — the point is the decimal count, not
  // the tie-break.
  return Math.round(value * factor) / factor;
}

/** A position, as this app stores and reads it. Accuracy is optional
 * because a `GeolocationPosition` is only REQUIRED to carry latitude,
 * longitude and accuracy — but a stored row may predate a writer that sent
 * one, and the reader must not assume. */
export type CapturedLocation = {
  latitude: number;
  longitude: number;
  /** The 95%-confidence radius in metres, or null when it is not known. */
  accuracyMeters: number | null;
};

export type LocationProblem =
  | "incomplete"
  | "not-a-number"
  | "latitude-out-of-range"
  | "longitude-out-of-range"
  | "accuracy-not-positive";

/**
 * The sentence for each way a coordinate can be refused.
 *
 * Here rather than at the call site so the wording cannot drift between the
 * browser (which drops the location and says so) and the action (which
 * refuses the whole record). Same arrangement as `tagNameProblemMessage`.
 */
export function locationProblemMessage(problem: LocationProblem): string {
  switch (problem) {
    case "incomplete":
      return "A location needs both a latitude and a longitude";
    case "not-a-number":
      return "That location is not a pair of numbers";
    case "latitude-out-of-range":
      return "That latitude is not on Earth";
    case "longitude-out-of-range":
      return "That longitude is not on Earth";
    case "accuracy-not-positive":
      return "A location's accuracy has to be a positive number of metres";
  }
}

/**
 * What the wire carries, before anything has been proved about it.
 *
 * Strings, because that is what a `FormData` field is and what a URL search
 * param is. `undefined`/`""` for every field means "no location", which is
 * the normal case and is not an error — see `parseCapturedLocation`.
 */
export type RawLocationFields = {
  latitude?: string | null;
  longitude?: string | null;
  accuracyMeters?: string | null;
};

export type ParsedLocation =
  | { ok: true; location: CapturedLocation | null }
  | { ok: false; problem: LocationProblem };

/**
 * Turns three form fields into a location, nothing, or a refusal.
 *
 * THREE OUTCOMES AND NOT TWO, which is the only shape that can be right
 * here. "No location" and "a bad location" are different things and must not
 * collapse into each other in either direction:
 *
 *   - if a bad coordinate became "no location", a client sending garbage
 *     would produce a silently unlocated photo and nobody would ever learn
 *     the writer was broken;
 *   - if "no location" became a refusal, every desktop upload and every
 *     denied permission would fail to record a photo — and the photo is the
 *     point, the coordinate is a bonus. That failure mode is the one this
 *     whole feature is written around.
 *
 * `null` is therefore returned for a completely absent triple, and only for
 * that. A latitude with no longitude is `"incomplete"` rather than null: it
 * means a writer sent half of something, which is a bug to surface, not a
 * photo without a location.
 *
 * Rounding happens HERE, so it happens once, on the way in, in the one place
 * both writers pass through.
 */
export function parseCapturedLocation(raw: RawLocationFields): ParsedLocation {
  const lat = (raw.latitude ?? "").trim();
  const lng = (raw.longitude ?? "").trim();
  const acc = (raw.accuracyMeters ?? "").trim();

  if (!lat && !lng && !acc) return { ok: true, location: null };
  if (!lat || !lng) return { ok: false, problem: "incomplete" };

  const latitude = Number(lat);
  const longitude = Number(lng);
  // `Number("")` is 0 and `Number("  ")` is 0, which is why both were tested
  // for emptiness above rather than left to this check — 0,0 is a real
  // coordinate in the Gulf of Guinea and must not be what a blank field
  // means.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, problem: "not-a-number" };
  }
  if (latitude < -90 || latitude > 90) return { ok: false, problem: "latitude-out-of-range" };
  if (longitude < -180 || longitude > 180) return { ok: false, problem: "longitude-out-of-range" };

  let accuracyMeters: number | null = null;
  if (acc) {
    const parsed = Number(acc);
    if (!Number.isFinite(parsed)) return { ok: false, problem: "not-a-number" };
    // Zero is refused as well as negative: the API defines accuracy as a
    // 95%-confidence radius, and no positioning system claims certainty.
    // The database says the same thing in `JobMedia_captured_location_range`.
    if (parsed <= 0) return { ok: false, problem: "accuracy-not-positive" };
    accuracyMeters = parsed;
  }

  return {
    ok: true,
    location: {
      latitude: roundCoordinate(latitude),
      longitude: roundCoordinate(longitude),
      accuracyMeters,
    },
  };
}

/* ------------------------------------------------------------------ *
 * When a fix may be called this capture's location
 * ------------------------------------------------------------------ */

/**
 * ONE HOUR, and this is the rule that makes the column's name honest.
 *
 * The browser can only read the position at UPLOAD time. `capturedAt` comes
 * off the file and can be days earlier — a crew uploading Friday's photos
 * from the office on Monday is the exact case `capturedAt` exists for. Left
 * alone, every one of those photos would be recorded as taken in the office
 * car park: not missing, not approximate, but confidently and specifically
 * wrong, on a record whose whole value is that it is evidence of a
 * particular place.
 *
 * An hour is wide enough for the real shape of the work — walk the building,
 * then upload from the truck or the trailer when there is signal — and
 * narrow enough that yesterday's photos never get today's position. Photos
 * older than that are recorded with no location, which is true, rather than
 * with a location that is false.
 *
 * The window is deliberately symmetric: a `lastModified` an hour in the
 * FUTURE is a device clock that is wrong (`jobMediaClockWarning` already
 * flags that), and a wrong clock is not evidence that the phone is where the
 * photo was taken.
 */
export const JOB_MEDIA_LOCATION_FRESHNESS_MS = 60 * 60 * 1000;

/**
 * May the position read now be recorded as where this capture was taken?
 *
 * Pure, and takes both instants, so the boundary is a thing a test can hold
 * still rather than something only a stopwatch could observe.
 *
 * CLIENT-SIDE ONLY, and that is written down here rather than implied. The
 * server cannot re-derive this: it is never told when the fix was taken, and
 * adding a column for that would be storing the app's own upload time a
 * second time. So this is a rule about what the browser OFFERS, not a
 * guarantee about what is in the database — which is fine, because unlike
 * the blob-URL checks next to it in `recordJobMedia`, the cost of getting it
 * wrong is a wrong location on one row that the person who uploaded it can
 * delete, not a cross-tenant hole.
 */
export function locationIsContemporary(capturedAt: Date, fixedAt: Date): boolean {
  const gap = Math.abs(fixedAt.getTime() - capturedAt.getTime());
  if (!Number.isFinite(gap)) return false;
  return gap <= JOB_MEDIA_LOCATION_FRESHNESS_MS;
}

/* ------------------------------------------------------------------ *
 * Reading it back — all of this is derived, none of it is stored
 * ------------------------------------------------------------------ */

/**
 * The coordinate as a person reads it: `36.16994, -115.13983`.
 *
 * Decimal degrees rather than degrees/minutes/seconds. DMS is what a survey
 * drawing uses and what nothing else does: it does not paste into a map
 * search box, it does not sort, and it invites a transcription error in the
 * one place a wrong digit is a different building.
 *
 * Padded to the stored precision so the string is a fixed width down a
 * column of cards — `36.17` and `36.16994` on adjacent rows read as two
 * different kinds of measurement when they are the same measurement.
 */
export function formatCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(JOB_MEDIA_COORDINATE_DECIMALS)}, ${longitude.toFixed(
    JOB_MEDIA_COORDINATE_DECIMALS,
  )}`;
}

/**
 * The error bar, written the way it should be read: `±8 m`, `±2.4 km`.
 *
 * Coarse on purpose above a kilometre. A fix reported as accurate to 2,431 m
 * is not accurate to the metre in any sense — the figure itself is an
 * estimate — so printing all four digits of it states a precision the
 * estimate does not have, which is the same mistake as storing seven
 * decimals of latitude.
 *
 * Null when there is no accuracy figure, and the caller renders nothing
 * rather than "±?": an absent error bar is not a value.
 */
export function formatAccuracy(accuracyMeters: number | null): string | null {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0) {
    return null;
  }
  if (accuracyMeters < 1000) return `±${Math.round(accuracyMeters)} m`;
  return `±${(accuracyMeters / 1000).toFixed(1)} km`;
}

/**
 * Above this, a fix is not telling you where somebody was standing.
 *
 * 100 m is roughly the point where a position stops distinguishing one
 * building from the next one. A GPS fix indoors can legitimately report
 * 30-60 m; a fix derived from the wifi neighbourhood reports a few hundred;
 * one derived from an IP address reports thousands. The first is a usable
 * "which site is this", the last two are not, and once stored all three are
 * the same shape of number.
 */
export const JOB_MEDIA_LOCATION_COARSE_METERS = 100;

/**
 * The sentence to show beside a fix too coarse to mean what it looks like,
 * or null.
 *
 * DERIVED ON EVERY READ from the stored accuracy, never written down. The
 * threshold is a judgement that may well change; a stored "coarse" flag
 * would keep the old judgement forever and disagree with the number printed
 * next to it. Same rule and same reasoning as `jobMediaClockWarning`.
 *
 * Phrased as what the reader should DO with it — treat it as the area, not
 * the spot — because a warning that only says "this is inaccurate" beside a
 * five-decimal number loses the argument with the number.
 */
export function locationCoarseNote(accuracyMeters: number | null): string | null {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters)) return null;
  if (accuracyMeters <= JOB_MEDIA_LOCATION_COARSE_METERS) return null;
  return "This fix is wide enough to cover the whole site — read it as the area, not the spot.";
}

/**
 * A link to a map, and deliberately NOT a map.
 *
 * NO MAPPING LIBRARY AND NO THIRD-PARTY SCRIPT. This app loads no external
 * JavaScript into any page, and a map widget is the single most common way
 * that stops being true — it also means every gallery card would hand a
 * crew member's position to a tile server on render, without anybody
 * choosing to. A link is a thing the person clicks, so the disclosure
 * happens when they decide it should.
 *
 * OpenStreetMap rather than Google Maps for one reason worth stating: the
 * URL needs no account, no key and no attribution obligation on our side,
 * so nothing about it can expire or start costing money. `mlat`/`mlon` drops
 * a marker; the `#map=` fragment sets the zoom, and 18 is roughly a city
 * block filling the screen.
 *
 * Built with `URLSearchParams` rather than string concatenation so a
 * coordinate can never carry anything into the query — this string is put
 * into an `href`, and a hand-built one is the shape that eventually takes an
 * unescaped value.
 */
export function mapLinkHref(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    mlat: latitude.toFixed(JOB_MEDIA_COORDINATE_DECIMALS),
    mlon: longitude.toFixed(JOB_MEDIA_COORDINATE_DECIMALS),
  });
  return `https://www.openstreetmap.org/?${params.toString()}#map=18/${latitude.toFixed(
    JOB_MEDIA_COORDINATE_DECIMALS,
  )}/${longitude.toFixed(JOB_MEDIA_COORDINATE_DECIMALS)}`;
}

/** Everything a card renders about where a capture was taken. Every field is
 * derived from the two or three stored numbers at read time. */
export type CapturedLocationSummary = {
  /** `36.16994, -115.13983` */
  coordinateLabel: string;
  /** `±8 m`, or null when the row carries no accuracy figure. */
  accuracyLabel: string | null;
  /** Non-null when the fix is too wide to read as a spot. */
  coarseNote: string | null;
  /** Where "Map" goes. */
  mapHref: string;
};

/**
 * The whole read-time projection, in one function, so both galleries and any
 * later surface get the same words.
 *
 * Takes the three stored columns in the shape Prisma returns them and gives
 * back null when there is no location — which is most rows, and is not a
 * degraded case. A caller that gets null renders nothing at all.
 *
 * A row with a latitude and no longitude cannot exist (the database refuses
 * it, `JobMedia_captured_location_pairing`), and this returns null for it
 * anyway rather than throwing: a read path is not where a person should
 * discover a constraint violation.
 */
export function describeCapturedLocation(row: {
  capturedLatitude: number | null;
  capturedLongitude: number | null;
  capturedAccuracyMeters: number | null;
}): CapturedLocationSummary | null {
  const { capturedLatitude: lat, capturedLongitude: lng } = row;
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    coordinateLabel: formatCoordinate(lat, lng),
    accuracyLabel: formatAccuracy(row.capturedAccuracyMeters),
    coarseNote: locationCoarseNote(row.capturedAccuracyMeters),
    mapHref: mapLinkHref(lat, lng),
  };
}

/* ------------------------------------------------------------------ *
 * Asking the browser
 * ------------------------------------------------------------------ */

/**
 * Why there is no location, in the words the person uploading gets.
 *
 * Every one of these is a branch that really happens on a real jobsite, and
 * the reason they are an enumerated type rather than a caught error is that
 * they need DIFFERENT sentences: "you said no" and "your phone has no GPS"
 * both end with an unlocated photo, and only one of them is worth telling
 * somebody how to change.
 */
export type LocationFailure =
  /** No `navigator.geolocation` at all — an old browser, or a hardened one. */
  | "unsupported"
  /** The page is not a secure context, so the API exists and can never
   *  succeed. Worth its own branch because the remedy is nothing to do with
   *  the person: it is the URL they are on. */
  | "insecure-context"
  /** `PERMISSION_DENIED`. Also what a browser reports when the prompt is
   *  answered "no" and, in most of them, when it is dismissed outright. */
  | "denied"
  /** `POSITION_UNAVAILABLE` — the hardware tried and could not get a fix.
   *  A basement, a lift shaft, a metal-clad building. */
  | "unavailable"
  /** `TIMEOUT`, or our own wall clock running out first. See
   *  `requestCaptureLocation` for why the second one has to exist. */
  | "timeout"
  /** A fix arrived and was not a usable coordinate. Should be impossible;
   *  kept because "impossible" values from a platform API are how a feature
   *  ends up recording NaN. */
  | "unusable"
  /** The photo is not from around now, so the phone's current position is
   *  not where it was taken. NOT a failure of the API — the API was never
   *  asked. */
  | "stale-capture";

export function locationFailureMessage(failure: LocationFailure): string {
  switch (failure) {
    case "unsupported":
      return "This browser cannot report a location, so these are filed without one.";
    case "insecure-context":
      return "Location needs a secure (https) page, so these are filed without one.";
    case "denied":
      return "Location is off for this site, so these are filed without one. Your browser's site settings is where that changes.";
    case "unavailable":
      return "Your phone could not get a fix — no sky, or no signal — so these are filed without a location.";
    case "timeout":
      return "Location took too long, so these are filed without one rather than holding up the upload.";
    case "unusable":
      return "The location your phone reported was not usable, so these are filed without one.";
    case "stale-capture":
      return "These files were not taken just now, so where you are standing is not where they were taken — filed without a location.";
  }
}

export type LocationAttempt =
  | { ok: true; location: CapturedLocation }
  | { ok: false; failure: LocationFailure };

/** The two members of `Geolocation` and `GeolocationPositionError` this
 * module uses, named structurally so a test can hand over a fake and a
 * browser can hand over the real thing. `PositionOptions` and friends are
 * DOM lib types; spelling the shape here keeps this module compiling in the
 * node test environment, which has no DOM lib. */
export type GeolocationLike = {
  getCurrentPosition(
    onSuccess: (position: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void,
    onError?: (error: { code: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
};

/** The three `GeolocationPositionError` codes, as constants rather than
 * magic numbers, because the interface's own named constants live on an
 * object the error carries and a fake would have to reproduce them. */
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

/** How long the whole attempt may take before the upload goes ahead without
 * a location.
 *
 * TWO TIMERS ARE NEEDED, NOT ONE, and this is the reason the second exists.
 * The `timeout` option is specified as covering the time spent ACQUIRING a
 * position and explicitly NOT the time spent obtaining the user's
 * permission — so a permission prompt that is dismissed rather than
 * answered, which is what a thumb hitting the wrong part of the screen
 * produces, can leave `getCurrentPosition` never calling back at all.
 * Neither callback fires, the option's timeout never starts, and an upload
 * that waits on it waits forever.
 *
 * Twelve seconds: long enough for a cold GPS fix outdoors (a warm one is
 * under two), short enough that a crew who ignored the prompt is not left
 * looking at a stalled screen. */
export const JOB_MEDIA_LOCATION_TIMEOUT_MS = 12_000;

/**
 * Asks for a position and ALWAYS answers.
 *
 * NEVER REJECTS AND NEVER HANGS, which is the entire contract. The caller is
 * an upload, the photo is the point and the coordinate is a bonus: a
 * location failure that could throw would be a location failure that loses
 * the photo, and a location failure that could hang would be one that loses
 * it more slowly.
 *
 * The wall-clock race is described on `JOB_MEDIA_LOCATION_TIMEOUT_MS`. The
 * first of the three outcomes to arrive wins, and everything after it is
 * dropped — `settled` rather than relying on a promise's own
 * resolve-once behaviour, so a late success cannot run the caller's work
 * twice through some future refactor.
 *
 * `enableHighAccuracy` is on: this is one fix per batch of uploads, on a
 * screen the person is already looking at, and the difference between the
 * network's guess and the GPS is the difference between "this building" and
 * "this postcode". `maximumAge` accepts a fix up to a minute old, because a
 * crew photographing a wall and then tapping upload has not moved and a
 * fresh acquisition would cost seconds for nothing.
 */
export function requestCaptureLocation(
  geolocation: GeolocationLike | null | undefined,
  options: {
    /** `window.isSecureContext`. Passed in rather than read, like every
     *  other environmental fact in this module. */
    secureContext: boolean;
    timeoutMs?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
  },
): Promise<LocationAttempt> {
  const timeoutMs = options.timeoutMs ?? JOB_MEDIA_LOCATION_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never));

  // Checked BEFORE the API is touched. On an insecure origin some browsers
  // remove `navigator.geolocation` and others keep it and answer
  // PERMISSION_DENIED — which would tell the person to change a permission
  // that is not the problem. The page's own protocol is the honest answer,
  // and it is knowable without asking anybody anything.
  if (!options.secureContext) {
    return Promise.resolve({ ok: false, failure: "insecure-context" });
  }
  if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
    return Promise.resolve({ ok: false, failure: "unsupported" });
  }

  return new Promise<LocationAttempt>((resolve) => {
    let settled = false;
    const finish = (attempt: LocationAttempt) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve(attempt);
    };

    const timer = setTimer(() => finish({ ok: false, failure: "timeout" }), timeoutMs);

    try {
      geolocation.getCurrentPosition(
        (position) => {
          const coords = position?.coords;
          const latitude = coords?.latitude;
          const longitude = coords?.longitude;
          if (typeof latitude !== "number" || typeof longitude !== "number") {
            finish({ ok: false, failure: "unusable" });
            return;
          }
          // Straight through the same parser the server uses, from the same
          // module, so a fix outside the ranges is refused here rather than
          // discovered by a CHECK constraint after 8MB has been uploaded.
          const parsed = parseCapturedLocation({
            latitude: String(latitude),
            longitude: String(longitude),
            accuracyMeters:
              typeof coords?.accuracy === "number" && coords.accuracy > 0
                ? String(coords.accuracy)
                : "",
          });
          if (!parsed.ok || !parsed.location) {
            finish({ ok: false, failure: "unusable" });
            return;
          }
          finish({ ok: true, location: parsed.location });
        },
        (error) => {
          switch (error?.code) {
            case PERMISSION_DENIED:
              finish({ ok: false, failure: "denied" });
              return;
            case POSITION_UNAVAILABLE:
              finish({ ok: false, failure: "unavailable" });
              return;
            case TIMEOUT:
              finish({ ok: false, failure: "timeout" });
              return;
            default:
              // A code this build does not know is still a refusal, and
              // "unavailable" is the honest reading of it: something went
              // wrong in the platform and there is no position.
              finish({ ok: false, failure: "unavailable" });
          }
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
      );
    } catch {
      // `getCurrentPosition` is not specified to throw synchronously, and a
      // hardened or instrumented browser can still do it. Caught rather than
      // allowed to escape, because an exception here would reject the
      // promise this function promises never to reject.
      finish({ ok: false, failure: "unsupported" });
    }
  });
}
