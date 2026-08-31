"use client";

import { useState } from "react";

/** The week, written out for a GC.
 *
 * This is the half of daily reporting that gives the person filing
 * something back. Logging days into a system that only management reads is
 * the shape of every abandoned construction tool; a week you can hand over
 * without retyping it is the reason to keep filing.
 *
 * Deliberately plain text rather than a formatted document. It has to
 * survive being pasted into an email, a text message, or a GC's own portal,
 * and every one of those strips formatting.
 */
export function WeekSummary({ text, label }: { text: string; label: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some embedded browsers. The text is
      // on screen and selectable, so say that rather than failing silently.
      setCopied(false);
      setIsOpen(true);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
        >
          {isOpen ? "Hide summary" : `Summary for ${label}`}
        </button>
        {isOpen && (
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {isOpen && (
        <>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
            {text}
          </pre>
          <p className="mt-1 text-xs text-slate-500">
            Days with no report are named in here rather than left out. A summary that lists
            only the days that exist reads as a complete week, and overstating your own record
            to a GC is worse than showing the hole.
          </p>
        </>
      )}
    </div>
  );
}
