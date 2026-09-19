/**
 * What gets burned into a site photo at the shutter, and what the queue
 * needs to carry it. Pure functions, so the wording and the rounding can be
 * checked without a camera — see scripts/photo-stamp-check.ts.
 *
 * The stamp is burned into the pixels (Diego's call) the way CompanyCam does
 * it: a photo that leaves the app — texted to a GC, pasted into a claim —
 * still says when and where it was taken.
 */

export type PhotoLocation = {
  latitude: number;
  longitude: number;
  /** The radius the phone says it is confident within, in metres. */
  accuracyMeters: number | null;
};

/** Five decimals is about a metre, and it is what the server stores
 * (lib/job-media-location.ts `roundCoordinate`). Sending more than the
 * server keeps would put a number on the photo that the record does not
 * have. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100000) / 100000;
}

export function formatCoordinate(location: PhotoLocation): string {
  return `${roundCoordinate(location.latitude).toFixed(5)}, ${roundCoordinate(location.longitude).toFixed(5)}`;
}

/** "±8 m" — the radius, rounded to a whole metre. Null when the phone did
 * not say, which is not the same as zero. */
export function formatAccuracy(accuracyMeters: number | null): string | null {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return null;
  return `±${Math.round(accuracyMeters)} m`;
}

/** "Fri, Sep 19, 2026 · 7:04 AM" in the phone's own zone — the zone the
 * person was standing in. Built from parts rather than toLocaleString so the
 * stamp reads the same on every phone. */
export function formatStampMoment(at: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = at.getHours();
  const suffix = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return (
    `${days[at.getDay()]}, ${months[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}` +
    ` · ${h12}:${String(at.getMinutes()).padStart(2, "0")} ${suffix}`
  );
}

/**
 * The lines burned into the corner of the photo. Two or three: the job, the
 * moment, and the place when there is one.
 *
 * A photo with no location still gets a stamp, and says so rather than
 * leaving a gap — "Location not recorded" is a fact about the photo, and a
 * missing line would read as one nobody bothered to include.
 */
export function stampLines(input: { jobName: string; capturedAt: Date; location: PhotoLocation | null }): string[] {
  const place = input.location
    ? [formatCoordinate(input.location), formatAccuracy(input.location.accuracyMeters)].filter(Boolean).join("  ")
    : "Location not recorded";
  return [input.jobName, formatStampMoment(input.capturedAt), place];
}

/** A file name for the stamped copy: the job's day and the capture time, so
 * a folder of downloads sorts by when the work happened. */
export function stampedFileName(capturedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `site-${capturedAt.getFullYear()}-${pad(capturedAt.getMonth() + 1)}-${pad(capturedAt.getDate())}` +
    `-${pad(capturedAt.getHours())}${pad(capturedAt.getMinutes())}${pad(capturedAt.getSeconds())}.jpg`
  );
}

/**
 * The shutter time, from the camera's own EXIF when it is there.
 *
 * EXIF `DateTimeOriginal` is "2026:09:19 07:04:11", in the camera's local
 * time and with no zone, so it is read as local. Anything unparseable falls
 * back to the moment given (the app's clock), which is what the old code
 * always used.
 */
export function capturedAtFromExif(exif: Record<string, unknown> | null | undefined, fallback: Date): Date {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== "string") return fallback;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return fallback;
  const [, y, mo, d, h, mi, s] = m;
  const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
