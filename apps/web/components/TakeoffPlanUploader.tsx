"use client";

import { useRef, useState, useTransition } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { uploadDocumentFile } from "@/lib/document-upload-client";
import { PDF_MAGIC_BYTES, looksLikePdf } from "@/lib/pdf-bytes";
import { recordTakeoffPlan } from "@/lib/actions";

/**
 * Puts a drawing where the viewer can open it.
 *
 * THE UPLOAD CANNOT GO THROUGH THE SERVER ACTION, and that is a framework
 * limit rather than a choice: Next caps an action body at 1MB, including
 * multipart file parts, and a bid sheet is far past it. So the browser uploads
 * under a one-shot token from `/api/documents/upload` and then calls the
 * action with the URL — the same triad site photos, contract documents and
 * document intake all already use.
 *
 * The magic-byte check is here so a DWG or a scanned JPEG is refused before a
 * token is minted, with a sentence naming what went wrong, instead of failing
 * later inside pdf.js where the message would be about a corrupt stream.
 */
export function TakeoffPlanUploader({ jobId }: { jobId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Pick a PDF of the sheet you're bidding.");
      return;
    }

    const head = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES).arrayBuffer());
    if (!looksLikePdf(head)) {
      setError("That file isn't a PDF. Export the sheet to PDF and try again.");
      return;
    }

    setBusy(true);
    const uploaded = await uploadDocumentFile("plan-takeoff", jobId, file);
    setBusy(false);
    if (!uploaded.ok) {
      setError(uploaded.error);
      return;
    }

    const formData = new FormData();
    formData.set("fileUrl", uploaded.fileUrl);
    if (uploaded.fileName) formData.set("fileName", uploaded.fileName);
    startTransition(async () => {
      const result = await recordTakeoffPlan(jobId, formData);
      if (result && !result.ok) {
        setError(result.error);
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="text-sm text-ink-body file:mr-3 file:rounded-md file:border file:border-line-card file:bg-surface-input file:px-3 file:py-1.5 file:text-sm file:text-ink-label"
        />
        <SubmitButton
          type="submit"
          disabled={busy || isPending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Add a drawing"}
        </SubmitButton>
      </div>
      <p className="text-xs text-ink-muted">
        Upload the sheets you&rsquo;re bidding rather than the whole set — this is a measuring tool, not a drawing
        register. The issued set belongs on Drawings.
      </p>
      {error && (
        <p role="alert" className="text-sm text-tag-rose-ink">
          {error}
        </p>
      )}
    </form>
  );
}
