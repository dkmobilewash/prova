"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";

/** The file name the server gave, or the fallback. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1]) : fallback;
}

/**
 * Downloads a file from a signed-in route by FETCHING it, never by navigating to it.
 *
 * Chrome round 4: "G703 as CSV" and "G703 as Excel" were plain links and returned
 * 503 on every press on a dev server, while fetching the same URLs from the page
 * returned 200. Why the press failed is NOT established: a signed-in Chromium on a
 * production build downloads through the plain link too (shoot-rehearsal beat 5b,
 * run with the links put back). So this takes the request Chrome saw succeed, and
 * a failure now shows on the page with its status instead of a browser error tab.
 */
export function DownloadButton({
  href,
  label,
  fallbackName,
  className,
}: {
  href: string;
  label: string;
  fallbackName: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(href, { credentials: "same-origin" });
      if (!response.ok) {
        setError(`That download did not work (HTTP ${response.status}). Reload the page and try again.`);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(response.headers.get("content-disposition"), fallbackName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("That download did not work. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={busy} onClick={() => void download()} className={className}>
        {busy ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Preparing…
          </span>
        ) : (
          label
        )}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
