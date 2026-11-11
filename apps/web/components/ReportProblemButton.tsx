"use client";

import { useEffect, useRef, useState } from "react";
import { reportProblem } from "@/lib/actions";
import { MAX_REPORT_MESSAGE, MAX_SCREENSHOT_BYTES } from "@/lib/problem-report";
import { installProblemReportBuffer, problemReportLines } from "./problemReportBuffer";
import { Spinner } from "./Spinner";

installProblemReportBuffer();

/**
 * The plan view as a JPEG: the drawing's canvas with the takeoff overlay on it,
 * scaled down until it fits under the action's body limit. Null where the page
 * has no plan view (the estimate), or when the picture cannot be made.
 */
async function capturePlanView(): Promise<string | null> {
  const port = document.querySelector('[data-testid="takeoff-plan-port"]');
  const sheet = port?.querySelector("canvas");
  if (!sheet || sheet.width === 0) return null;
  const overlay = port?.querySelector("svg");
  let overlayImage: HTMLImageElement | null = null;
  if (overlay) {
    try {
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(overlay)], { type: "image/svg+xml" }));
      overlayImage = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
      URL.revokeObjectURL(url);
    } catch {
      overlayImage = null;
    }
  }
  for (const [width, quality] of [[1400, 0.7], [1000, 0.6], [700, 0.5]] as const) {
    try {
      const scale = Math.min(1, width / sheet.width);
      const out = document.createElement("canvas");
      out.width = Math.round(sheet.width * scale);
      out.height = Math.round(sheet.height * scale);
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(sheet, 0, 0, out.width, out.height);
      if (overlayImage) ctx.drawImage(overlayImage, 0, 0, out.width, out.height);
      const url = out.toDataURL("image/jpeg", quality);
      if ((url.length * 3) / 4 < MAX_SCREENSHOT_BYTES) return url;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * "Report a problem": in the takeoff workspace and on the estimate. The press takes
 * the picture of the plan view first, before this panel covers any of it; Send adds
 * what the person typed and the page's recent errors and clicks, and the action
 * mails support (`reportProblem`).
 */
export function ReportProblemButton({ pageNumber, className }: { pageNumber?: number; className: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const shot = useRef<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  async function start() {
    setError(null);
    setState("idle");
    setMessage("");
    shot.current = await capturePlanView();
    setOpen(true);
  }

  async function send() {
    setState("sending");
    setError(null);
    try {
      const result = await reportProblem({
        pagePath: location.pathname,
        pageNumber: pageNumber ?? null,
        message,
        ...problemReportLines(),
        screenshot: shot.current,
        userAgent: navigator.userAgent,
      });
      if (!result.ok) {
        setState("idle");
        setError(result.error);
        return;
      }
      setState("sent");
    } catch {
      setState("idle");
      setError("Couldn't send just now: the connection dropped. Try again in a moment.");
    }
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => void start()} className={className} data-report="open" aria-expanded={open}>
        Report a problem
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-line-card bg-surface p-3 text-left shadow-xl" data-report="panel">
          {state === "sent" ? (
            <div role="status">
              <p className="text-sm font-medium text-ink" data-report="sent">
                Sent. We&apos;ll look at it.
              </p>
              <button type="button" onClick={() => setOpen(false)} className="mt-2 min-h-11 rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover">
                Close
              </button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="block text-sm font-medium text-ink" htmlFor="report-message">
                What went wrong?
              </label>
              <textarea
                id="report-message"
                ref={box}
                value={message}
                maxLength={MAX_REPORT_MESSAGE}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                placeholder="A line is enough: what you pressed and what you expected."
                className="mt-1 w-full rounded-md border border-line-card bg-surface px-2 py-1.5 text-sm text-ink"
                data-report="message"
              />
              <p className="mt-1 text-xs text-ink-muted" data-report="what">
                Sends support this page, {pageNumber ? "the sheet, a picture of the plan view, " : ""}the page&apos;s recent errors and clicks, and your name. Only your own job.
              </p>
              {error !== null && (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {error}
                </p>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover">
                  Cancel
                </button>
                <button type="submit" disabled={state === "sending"} className="min-h-11 rounded-md bg-brand px-3 text-sm font-semibold text-neutral-900 disabled:opacity-50" data-report="send">
                  {state === "sending" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Spinner />
                      Sending…
                    </span>
                  ) : (
                    "Send"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
