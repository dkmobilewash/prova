"use client";

import { useState } from "react";
import { SKIP_SENTENCE, type SkippedPart } from "@/lib/estimating/bid-package";
import type { PackageContents, SubmittalCover } from "@/lib/submittal-package";

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-rail-hover disabled:opacity-50";

/**
 * Picks the product data, builds cover plus files on this machine, and
 * downloads it. Sits inside the send form: the date on the cover is read from
 * that form at the press, and the list of what went in is handed up so
 * "Record as sent" keeps it on the revision. Nothing is uploaded.
 */
export function SubmittalPackageBuilder({
  cover,
  onContents,
}: {
  cover: Omit<SubmittalCover, "sentOn">;
  onContents: (contents: PackageContents | null) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedPart[]>([]);
  const [built, setBuilt] = useState<PackageContents | null>(null);

  async function build(form: HTMLFormElement | null) {
    setBusy(true);
    setError(null);
    setSkipped([]);
    try {
      const { buildSubmittalPackage, submittalPackageFileName } = await import("@/lib/submittal-package");
      const sentOn = form ? String(new FormData(form).get("sentOn") ?? "") : "";
      const parts = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
      const result = await buildSubmittalPackage({ ...cover, sentOn: sentOn || null }, parts);
      setSkipped(result.skipped);
      setBuilt(result.contents);
      onContents(result.contents);
      if (result.bytes === null) return;
      const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = submittalPackageFileName(cover);
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("That package could not be built. Check the files are PDFs and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line-card p-3">
      <p className="text-sm text-ink-label">Build the package (optional)</p>
      <p className="text-xs text-ink-muted">
        Pick the cut sheets and shop drawings as PDFs, in the order they should appear. This adds a cover sheet, joins
        them and downloads one file. Nothing is uploaded or sent; only the file names and page counts are kept with this
        revision.
      </p>
      <input
        type="file"
        multiple
        accept="application/pdf,.pdf"
        aria-label="Files for the package"
        className="text-sm text-ink-body"
        onChange={(event) => {
          setFiles(Array.from(event.currentTarget.files ?? []));
          // A new pick means the last build no longer describes what is
          // being sent, so its list must not be recorded.
          setBuilt(null);
          setSkipped([]);
          onContents(null);
        }}
      />
      <div>
        <button
          type="button"
          disabled={busy || files.length === 0}
          onClick={(event) => void build(event.currentTarget.form)}
          className={btn}
        >
          {busy ? "Building…" : "Build and download package"}
        </button>
      </div>
      {built && (
        <p className="text-xs text-ink-body">
          Downloaded: cover plus {built.files.length} file{built.files.length === 1 ? "" : "s"}, {built.totalPages} pages.
        </p>
      )}
      {skipped.map((part) => (
        <p key={part.name} className="text-xs text-warn">
          Left out {part.name}: {SKIP_SENTENCE[part.reason]}.
        </p>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
