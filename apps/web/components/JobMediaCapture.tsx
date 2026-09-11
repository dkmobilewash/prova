"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { recordJobMedia } from "@/lib/actions";
import {
  JOB_MEDIA_CONTENT_TYPES,
  JOB_MEDIA_PHOTO_MAX_BYTES,
  JOB_MEDIA_VIDEO_MAX_BYTES,
  formatByteSize,
  isAllowedJobMediaType,
  jobMediaKind,
  jobMediaMaxBytes,
  jobMediaUploadErrorMessage,
  jobMediaUploadPathname,
} from "@/lib/job-media";
import {
  locationFailureMessage,
  locationIsContemporary,
  requestCaptureLocation,
  type CapturedLocation,
  type LocationFailure,
} from "@/lib/job-media-location";

/**
 * Picking photos, videos and voice notes, and getting them onto a job.
 *
 * THE FILE GOES STRAIGHT TO THE BLOB STORE, not through a Server Action.
 * `upload()` asks `/api/job-media/upload` for a one-shot token (that route
 * is where every access decision is made) and then PUTs the bytes to
 * Vercel Blob directly. Only the resulting URL comes back through a Server
 * Action, which is a few hundred bytes.
 *
 * The alternative — a `<form action={uploadThing}>` carrying the File, as
 * the four existing document uploads do — cannot work: Next caps a Server
 * Action body at exactly 1MB and a phone photo is several times that. See
 * issue #27 and the route handler's header.
 *
 * ONE FILE AT A TIME, sequentially, on purpose. A crew on site is on a
 * phone on LTE inside a steel building; six parallel uploads on that
 * connection is how you get six timeouts instead of two photos. Sequential
 * also means the count below is honest about what has actually landed.
 *
 * The button is disabled while anything is in flight. `recordJobMedia` is
 * not idempotent, and this app has a standing scar from create buttons
 * that stayed live through a slow round-trip and got clicked twice (#19).
 *
 * Sizing follows the field-screen rules from #89: 44px minimum tap
 * targets (`min-h-11`) and `text-base` on anything focusable, because iOS
 * Safari zooms the whole page when a focused input renders under 16px —
 * which on a form like this leaves you zoomed in and scrolled sideways
 * after every tap.
 *
 * THE PATHNAME IS SCOPED TO THE JOB, and that is a security boundary
 * rather than tidy filing. It used to upload to the bare `file.name`, so
 * the token minted for it named no job at all and nothing downstream could
 * tell one company's photo from another's. lib/job-media.ts holds the
 * rule, the route enforces it before minting, and `recordJobMedia`
 * enforces it again on the URL that comes back.
 *
 * THE RECORDER IS THE PHONE'S OWN, NOT `MediaRecorder`, and that is the
 * main decision in this file. An in-page record button was the obvious
 * build and is the wrong one for this app:
 *
 *   - what a browser recorder produces is whatever THAT browser supports.
 *     Android Chrome gives `audio/webm`, which Safari cannot play at all —
 *     so the natural implementation quietly produces voice notes a GC on
 *     an iPhone hears as silence, and it produces them by default rather
 *     than as an edge case;
 *   - the phone's own camera and voice-memo app produce `.mov`/`.m4a`,
 *     which play essentially everywhere, and they already handle the parts
 *     a web recorder gets wrong on site: interruption by a phone call,
 *     backgrounding, locking the screen mid-narration;
 *   - a file input with `accept="video/*"` opens the camera on both iOS
 *     and Android, so the crew still taps once to record.
 *
 * The cost is honest and small: on a DESKTOP this is a file picker rather
 * than a record button, so narrating from a laptop means recording in
 * another app first. That is the trade taken — a desktop is not where a
 * walk-through gets narrated.
 *
 * WHERE IT WAS TAKEN IS ASKED FOR ONCE PER BATCH, AND NEVER BLOCKS.
 * `requestCaptureLocation` cannot reject and cannot hang — see its own note
 * on why two timers are needed, because a dismissed permission prompt calls
 * neither callback and the API's own timeout does not cover the prompt. If
 * it says no for any of its six reasons, the batch uploads unlocated and the
 * reason is printed under the outcomes. The photo is the point; the
 * coordinate is a bonus, and a bonus that can lose the photo is a defect.
 *
 * ONE FIX FOR THE WHOLE BATCH rather than one per file: a crew picks six
 * photos of the same wall and the phone is in one place, so six acquisitions
 * would differ by GPS noise rather than by movement and would cost seconds
 * each on the connection this component is already careful about.
 *
 * AND ONLY FOR FILES THAT ARE FROM AROUND NOW. The position is read at
 * UPLOAD time, and `capturedAt` comes off the file — so Friday's photos
 * uploaded from the office on Monday would every one be recorded in the
 * office car park. `locationIsContemporary` is checked PER FILE, against
 * that file's own capture time, so a batch mixing this morning's photos with
 * last week's locates the first and not the second rather than making one
 * decision for all of them.
 *
 * THE TYPE IS CHECKED BEFORE ANYTHING IS STORED, for a different reason.
 * The store decides a blob's content type from the pathname's extension
 * unless it is told one (@vercel/blob@2.8.0 dist/index.d.ts:461), while
 * `recordJobMedia` validates `file.type`, which is what the BROWSER said.
 * When those two disagreed — an extension the store maps differently, or a
 * HEIC a browser reports as `""` — the upload SUCCEEDED and the record
 * call then failed, leaving a file in the store with no row pointing at
 * it and nothing that would ever find it again. So the browser's own value
 * is checked here first and then passed to `upload()` as an explicit
 * `contentType`, which makes it the single value both sides see. A file
 * that cannot be recorded is now never stored.
 */

type Outcome = { name: string; ok: boolean; message?: string };

/** What happened to the location for this batch: a fix, or the reason there
 * isn't one. Kept as the FAILURE rather than as a rendered sentence so the
 * wording stays in the one pure module both this and the server import. */
type LocationOutcome =
  | { ok: true; location: CapturedLocation; usedOn: number; skippedStale: number }
  | { ok: false; failure: LocationFailure };

const ACCEPT = JOB_MEDIA_CONTENT_TYPES.join(",");

export function JobMediaCapture({ jobId }: { jobId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; percent: number } | null>(
    null,
  );
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [locationOutcome, setLocationOutcome] = useState<LocationOutcome | null>(null);

  async function handleFiles(files: File[]) {
    setBusy(true);
    setOutcomes([]);
    setLocationOutcome(null);
    const results: Outcome[] = [];

    // ASKED FOR FIRST AND ONCE, before any bytes move. `navigator` and
    // `window` are read HERE rather than inside the helper, which takes them
    // as arguments — that is what lets every branch below be produced by a
    // fake in a unit test instead of only by a real phone.
    //
    // `await`ed rather than raced against the upload deliberately: the
    // prompt is a modal the person is looking at, and starting a 200MB
    // upload underneath it is how a phone ends up doing both badly. The wait
    // is bounded by the helper's own wall clock.
    const attempt = await requestCaptureLocation(
      typeof navigator === "undefined" ? null : navigator.geolocation,
      { secureContext: typeof window !== "undefined" && window.isSecureContext },
    );
    const fixedAt = new Date();
    let usedOn = 0;
    let skippedStale = 0;

    for (const [index, file] of files.entries()) {
      setProgress({ index: index + 1, total: files.length, percent: 0 });

      // Refused BEFORE the bytes move rather than after they land. This is
      // the same allowlist the token and the action use; what makes the
      // check matter here is that the value being checked — the browser's
      // `file.type` — is the exact value both of those will see, because
      // it is handed to `upload()` below and sent to `recordJobMedia`
      // afterwards. An empty `file.type` (a HEIC on a browser that will
      // not name it) is refused for the same reason: it is a file this app
      // cannot record, and storing it would orphan it.
      const contentType = file.type;
      if (!isAllowedJobMediaType(contentType)) {
        results.push({
          name: file.name,
          ok: false,
          message: `Not a file this app can file (${contentType || "the browser did not say what it is"}) — a photo, a video, or a voice recording`,
        });
        continue;
      }

      // Null only if the job id is not one this app issued, which would be
      // a bug rather than a bad file — refused rather than uploaded to
      // somewhere unscoped.
      // THE SIZE CHECK COMES AFTER THE TYPE CHECK NOW, and the order is
      // load-bearing rather than tidy: the cap depends on the kind, so
      // there is no number to compare against until the type is known. It
      // is still only the fast, kind version of the rule — the store
      // enforces the same ceiling on the transfer itself, and
      // `recordJobMedia` enforces it again on the row.
      const maxBytes = jobMediaMaxBytes(contentType);
      if (maxBytes !== null && file.size > maxBytes) {
        results.push({
          name: file.name,
          ok: false,
          message: `Too large (${formatByteSize(file.size)}, limit ${formatByteSize(maxBytes)} for a ${jobMediaKind(contentType)})`,
        });
        continue;
      }

      // The capture time this file will be filed under — computed here
      // rather than at the point it is sent, because the freshness rule is
      // asked of exactly the same instant the row will carry. A browser
      // reporting `lastModified` as 0 falls back to now, which is also the
      // honest reading: nothing says the file is old.
      const capturedAt = new Date(file.lastModified || Date.now());
      // PER FILE, not per batch. A batch can legitimately mix this
      // morning's walk with a photo picked out of the camera roll from last
      // week, and the second one's location is genuinely unknown.
      const locate = attempt.ok && locationIsContemporary(capturedAt, fixedAt);
      if (attempt.ok) {
        if (locate) usedOn += 1;
        else skippedStale += 1;
      }

      const pathname = jobMediaUploadPathname(jobId, file.name);
      if (!pathname) {
        results.push({ name: file.name, ok: false, message: "That job cannot take captures" });
        continue;
      }

      try {
        const blob = await upload(pathname, file, {
          access: "public",
          contentType,
          handleUploadUrl: "/api/job-media/upload",
          // The type is declared to the route as well as to the store, so
          // the token can be minted for THIS type at THIS kind's cap
          // rather than for the whole allowlist at one ceiling. It is a
          // claim, and the route treats it as one — see the route's own
          // note on why lying about it only costs the liar an upload.
          clientPayload: JSON.stringify({ jobId, contentType }),
          // Splits, parallelises and retries parts rather than sending one
          // long PUT that a truck driving out of range kills at 90%. Only
          // for the big ones: below the video cap a single request is
          // fewer round trips, and a phone photo finishes either way.
          multipart: file.size > JOB_MEDIA_VIDEO_MAX_BYTES / 4,
          onUploadProgress: ({ percentage }) =>
            setProgress({ index: index + 1, total: files.length, percent: percentage }),
        });

        const formData = new FormData();
        formData.set("blobUrl", blob.url);
        formData.set("contentType", contentType);
        formData.set("byteSize", String(file.size));
        // The file's own timestamp is when the picture was taken; `now` is
        // only a fallback for a browser that reports 0. Sent as an instant
        // rather than a date so the ordering within a day survives.
        formData.set("capturedAt", capturedAt.toISOString());
        // Sent as strings because that is what a FormData field is, and
        // omitted entirely rather than sent empty when there is no location
        // — `parseCapturedLocation` reads three absent fields as "no
        // location", which is the normal case and not an error.
        if (locate && attempt.ok) {
          formData.set("latitude", String(attempt.location.latitude));
          formData.set("longitude", String(attempt.location.longitude));
          if (attempt.location.accuracyMeters !== null) {
            formData.set("accuracyMeters", String(attempt.location.accuracyMeters));
          }
        }

        const result = await recordJobMedia(jobId, formData);
        results.push(
          result.ok
            ? { name: file.name, ok: true }
            : { name: file.name, ok: false, message: result.error },
        );
      } catch (err) {
        // Not `err.message` directly: for anything the token route refuses,
        // that message is the SDK's own "Failed to  retrieve the client
        // token" and never the sentence the route wrote — it discards the
        // response body (dist/client.js:398-400). See
        // `jobMediaUploadErrorMessage`, which says so rather than dressing
        // it up.
        results.push({ name: file.name, ok: false, message: jobMediaUploadErrorMessage(err) });
      }
    }

    setOutcomes(results);
    setLocationOutcome(
      attempt.ok ? { ok: true, location: attempt.location, usedOn, skippedStale } : attempt,
    );
    setProgress(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const failures = outcomes.filter((o) => !o.ok);
  const succeeded = outcomes.length - failures.length;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-base text-slate-300">
        <span className="text-sm">
          Photos, video or a voice note — up to {formatByteSize(JOB_MEDIA_PHOTO_MAX_BYTES)} a photo,{" "}
          {formatByteSize(JOB_MEDIA_VIDEO_MAX_BYTES)} a video. On a phone this opens the camera or the
          voice recorder.
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void handleFiles(files);
          }}
          className="min-h-11 text-base text-slate-300 file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-slate-800 file:px-4 file:text-base file:font-medium file:text-slate-100 hover:file:bg-slate-700 disabled:opacity-50"
        />
      </label>

      {progress && (
        <p aria-live="polite" className="text-sm text-slate-400">
          Uploading {progress.index} of {progress.total} — {Math.round(progress.percent)}%
        </p>
      )}

      {outcomes.length > 0 && (
        <div aria-live="polite" className="flex flex-col gap-1 text-sm">
          {succeeded > 0 && (
            <p className="text-slate-400">
              Added {succeeded} file{succeeded === 1 ? "" : "s"}.
            </p>
          )}
          {failures.map((failure) => (
            <p key={failure.name} className="text-red-400">
              {failure.name}: {failure.message}
            </p>
          ))}
          {/* WHAT HAPPENED TO THE LOCATION, said out loud rather than left
              to be noticed on the card afterwards.

              slate-400, NOT red or amber: no location is not an error and
              must not be dressed as one. Every capture taken before this
              shipped has none, and a crew that tapped "Don't allow" made a
              choice the product respects. Colouring it as a failure turns a
              respected choice into a nag on every single upload.

              The "some of these were not taken just now" line is the one
              that would otherwise be baffling — the phone plainly knows
              where it is, and the photos came back unlocated. Saying which
              files and why is the difference between a rule and a bug. */}
          {locationOutcome &&
            (locationOutcome.ok ? (
              <>
                {locationOutcome.usedOn > 0 && (
                  <p className="text-slate-400">
                    Location recorded on {locationOutcome.usedOn} of {outcomes.length} file
                    {outcomes.length === 1 ? "" : "s"}.
                  </p>
                )}
                {locationOutcome.skippedStale > 0 && (
                  <p className="text-slate-400">
                    {locationOutcome.skippedStale} file
                    {locationOutcome.skippedStale === 1 ? " was" : "s were"} not taken just now, so
                    where you are standing is not where {locationOutcome.skippedStale === 1 ? "it" : "they"}{" "}
                    {locationOutcome.skippedStale === 1 ? "was" : "were"} taken — filed without a
                    location.
                  </p>
                )}
              </>
            ) : (
              <p className="text-slate-400">{locationFailureMessage(locationOutcome.failure)}</p>
            ))}
        </div>
      )}
    </div>
  );
}
