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

const ACCEPT = JOB_MEDIA_CONTENT_TYPES.join(",");

export function JobMediaCapture({ jobId }: { jobId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; percent: number } | null>(
    null,
  );
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  async function handleFiles(files: File[]) {
    setBusy(true);
    setOutcomes([]);
    const results: Outcome[] = [];

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
        formData.set(
          "capturedAt",
          new Date(file.lastModified || Date.now()).toISOString(),
        );

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
    setProgress(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const failures = outcomes.filter((o) => !o.ok);
  const succeeded = outcomes.length - failures.length;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-base text-ink-label">
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
          className="min-h-11 text-base text-ink-label file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-neutral-100 file:px-4 file:text-base file:font-medium file:text-ink hover:file:bg-neutral-200 disabled:opacity-50"
        />
      </label>

      {progress && (
        <p aria-live="polite" className="text-sm text-ink-body">
          Uploading {progress.index} of {progress.total} — {Math.round(progress.percent)}%
        </p>
      )}

      {outcomes.length > 0 && (
        <div aria-live="polite" className="flex flex-col gap-1 text-sm">
          {succeeded > 0 && (
            <p className="text-ink-body">
              Added {succeeded} file{succeeded === 1 ? "" : "s"}.
            </p>
          )}
          {failures.map((failure) => (
            <p key={failure.name} className="text-red-600">
              {failure.name}: {failure.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
