"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { recordJobMedia } from "@/lib/actions";
import { JOB_MEDIA_CONTENT_TYPES, JOB_MEDIA_MAX_BYTES, formatByteSize } from "@/lib/job-media";

/**
 * Picking photos and getting them onto a job.
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

      // Checked here so the person is told in the file picker's own terms
      // rather than by a rejected token three seconds later. The real
      // enforcement is still server-side, on the token and again in the
      // action — this is only the fast, kind version of the same rule.
      if (file.size > JOB_MEDIA_MAX_BYTES) {
        results.push({
          name: file.name,
          ok: false,
          message: `Too large (${formatByteSize(file.size)}, limit ${formatByteSize(JOB_MEDIA_MAX_BYTES)})`,
        });
        continue;
      }

      try {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/job-media/upload",
          clientPayload: JSON.stringify({ jobId }),
          onUploadProgress: ({ percentage }) =>
            setProgress({ index: index + 1, total: files.length, percent: percentage }),
        });

        const formData = new FormData();
        formData.set("blobUrl", blob.url);
        formData.set("blobPathname", blob.pathname);
        formData.set("contentType", file.type);
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
        results.push({
          name: file.name,
          ok: false,
          message: err instanceof Error ? err.message : "Upload failed",
        });
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
      <label className="flex flex-col gap-1 text-base text-slate-300">
        <span className="text-sm">Photos (JPEG, PNG, WEBP or HEIC — up to 25MB each)</span>
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
              Added {succeeded} photo{succeeded === 1 ? "" : "s"}.
            </p>
          )}
          {failures.map((failure) => (
            <p key={failure.name} className="text-red-400">
              {failure.name}: {failure.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
