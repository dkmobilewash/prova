"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { recordIntakeDocument } from "@/lib/actions";
import {
  INTAKE_ACCEPT_ATTRIBUTE,
  INTAKE_MAX_FILES,
  INTAKE_MAX_FILE_BYTES,
  formatIntakeSize,
  intakeUploadErrorMessage,
  intakeUploadPathname,
  isAllowedIntakeType,
} from "@/lib/intake/upload";

/**
 * Drop a folder in. Everything else on this screen is about what happens
 * next.
 *
 * THE FILES GO STRAIGHT TO THE BLOB STORE, not through a Server Action:
 * Next caps an action body at exactly 1MB, file parts included (#27), and a
 * scanned submittal is several times that. `upload()` asks
 * `/api/intake/upload` for a one-shot token — that route is where every
 * access decision is made — and PUTs the bytes itself. Only the resulting
 * URL comes back through `recordIntakeDocument`.
 *
 * A REAL FOLDER, THREE WAYS, because the person doing this is holding a
 * folder and not a list of files: dragging a folder onto the zone (the
 * directory is walked below), the "Choose a folder" button
 * (`webkitdirectory`), and ordinary multi-select for the case where the
 * documents are loose in a Downloads folder.
 *
 * THE CAPS ARE PRINTED ON THE ZONE. A drop of 300 files that quietly
 * processes 120 is worse than a refusal, because the 180 that vanished look
 * exactly like files that were filed — and this screen's entire promise is
 * that nothing goes missing between an email and a job.
 *
 * FOUR AT A TIME. One at a time is honest and takes a minute on a folder of
 * eighty; unbounded parallelism opens eighty sockets and finishes slower
 * while failing more. Four is small enough that the progress line is a real
 * count of what has landed rather than what has been started.
 */

const CONCURRENCY = 4;

type Outcome = { name: string; ok: boolean; message?: string };

/** Every file under a dropped directory, depth-first.
 *
 * A dragged FOLDER is not in `dataTransfer.files` in any useful form — it
 * appears as a single entry with no type — so the only way to get at what
 * is inside it is the entry API. Unsupported in Firefox for directories,
 * which is why `filesFromDataTransfer` falls back to the flat file list
 * rather than refusing: a person who drags a folder into a browser that
 * cannot read it gets nothing at all, and should get the same "choose a
 * folder" button they would have used anyway.
 */
async function filesUnder(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise<File[]>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const out: File[] = [];
  // `readEntries` returns at most 100 per call and signals the end with an
  // empty batch — reading it once silently truncates a folder of 120, which
  // is exactly the size this screen is built for.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (batch.length === 0) break;
    for (const child of batch) out.push(...(await filesUnder(child)));
  }
  return out;
}

async function filesFromDataTransfer(transfer: DataTransfer): Promise<File[]> {
  const entries = [...transfer.items]
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry?.() ?? null : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return [...transfer.files];
  const nested = await Promise.all(entries.map(filesUnder));
  return nested.flat();
}

/**
 * `companyId` is handed down by the server page, and it is ONLY ever a path
 * hint — it decides what pathname this browser ASKS to write to, and nothing
 * else. The token route ignores what the client claims and re-derives the
 * company from the session before it signs anything
 * (`isIntakePathname(pathname, context.companyId)`), and
 * `recordIntakeDocument` checks the returned URL against the session's
 * company a third time. Editing this value in a devtools console buys a
 * refused token, not somebody else's folder.
 */
export function IntakeDropZone({ companyId }: { companyId: string }) {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  // `webkitdirectory` is not in React's attribute types and is the only way
  // to open a folder picker. Set on the element itself rather than cast
  // through `any`, which the lint config refuses.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  async function handleFiles(all: File[]) {
    setRefusal(null);
    setOutcomes([]);
    // Empty folders and hidden files a directory walk picks up (.DS_Store on
    // every Mac folder that has ever been opened) are dropped before the
    // count, so the cap is about documents rather than about junk.
    const files = all.filter((file) => file.size > 0 && !file.name.startsWith("."));
    if (files.length === 0) {
      setRefusal("Nothing in that drop was a file this app can take in.");
      return;
    }
    if (files.length > INTAKE_MAX_FILES) {
      setRefusal(
        `That is ${files.length} files and the limit is ${INTAKE_MAX_FILES} at a time. Nothing has been uploaded — split the folder and drop it in two goes.`,
      );
      return;
    }

    setBusy(true);
    const results: Outcome[] = [];
    let done = 0;
    setProgress({ done: 0, total: files.length });

    const one = async (file: File) => {
      const record = (outcome: Outcome) => {
        results.push(outcome);
        done += 1;
        setProgress({ done, total: files.length });
      };

      // Refused BEFORE the bytes move rather than after they land. The value
      // checked here — the browser's own `file.type` — is the exact value
      // the token route and the recording action will see, because it is
      // handed to `upload()` as an explicit contentType below. When those
      // disagreed on the photo feature the upload SUCCEEDED and the record
      // call failed, leaving a file in the store with no row pointing at it.
      const contentType = file.type;
      if (!isAllowedIntakeType(contentType)) {
        record({
          name: file.name,
          ok: false,
          message: `Not a file type this app can take in (${contentType || "the browser did not say what it is"})`,
        });
        return;
      }
      if (file.size > INTAKE_MAX_FILE_BYTES) {
        record({
          name: file.name,
          ok: false,
          message: `Too large (${formatIntakeSize(file.size)}, limit ${formatIntakeSize(INTAKE_MAX_FILE_BYTES)})`,
        });
        return;
      }
      const pathname = intakeUploadPathname(companyId, file.name);
      if (!pathname) {
        record({ name: file.name, ok: false, message: "This company cannot take uploads" });
        return;
      }

      try {
        const blob = await upload(pathname, file, {
          access: "public",
          contentType,
          handleUploadUrl: "/api/intake/upload",
          clientPayload: JSON.stringify({ contentType }),
        });

        const formData = new FormData();
        formData.set("blobUrl", blob.url);
        formData.set("fileName", file.name);
        formData.set("contentType", contentType);
        formData.set("byteSize", String(file.size));

        const result = await recordIntakeDocument(formData);
        record(
          result.ok
            ? { name: file.name, ok: true }
            : { name: file.name, ok: false, message: result.error },
        );
      } catch (err) {
        // Not `err.message`: for anything the token route refuses, that
        // message is the SDK's own "Failed to  retrieve the client token"
        // and never the sentence the route wrote — it discards the response
        // body. See `intakeUploadErrorMessage`.
        record({ name: file.name, ok: false, message: intakeUploadErrorMessage(err) });
      }
    };

    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
        for (;;) {
          const index = next;
          next += 1;
          if (index >= files.length) return;
          await one(files[index]);
        }
      }),
    );

    setOutcomes(results);
    setProgress(null);
    setBusy(false);
    if (filesRef.current) filesRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
  }

  const failures = outcomes.filter((o) => !o.ok);
  const succeeded = outcomes.length - failures.length;

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (busy) return;
          void filesFromDataTransfer(event.dataTransfer).then(handleFiles);
        }}
        className={`rounded-lg border-2 border-dashed p-6 text-center ${
          over ? "border-brand bg-surface" : "border-line-card"
        }`}
      >
        <p className="text-base font-medium text-ink">
          Drop the whole folder here
        </p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-ink-body">
          Everything a GC has sent you — transmittals, returned submittals, COIs, pay apps, signed
          change orders. We read each one and propose where it goes. Nothing is filed until you say
          so.
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          Up to {INTAKE_MAX_FILES} files at a time, {formatIntakeSize(INTAKE_MAX_FILE_BYTES)} each.
          PDFs, images, Word and Excel.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => folderRef.current?.click()}
            className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            Choose a folder
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => filesRef.current?.click()}
            className="min-h-11 rounded-md border border-line-card px-4 text-sm text-ink hover:border-ink-muted disabled:opacity-50"
          >
            Choose files
          </button>
        </div>

        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void handleFiles(files);
          }}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          hidden
          accept={INTAKE_ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void handleFiles(files);
          }}
        />

        {progress && (
          <p className="mt-3 text-sm text-ink-body">
            Reading {progress.done} of {progress.total}…
          </p>
        )}
      </div>

      {refusal && <p className="mt-3 text-sm text-tag-rose-ink">{refusal}</p>}

      {outcomes.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-ink-body">
            {succeeded} added to the tray
            {failures.length > 0 ? `, ${failures.length} could not be` : ""}.
          </p>
          {/* Named, never counted only: a file that did not make it is the
              one thing this screen cannot leave a person to discover. */}
          {failures.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-tag-rose-ink">
              {failures.map((failure) => (
                <li key={failure.name}>
                  {failure.name} — {failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
