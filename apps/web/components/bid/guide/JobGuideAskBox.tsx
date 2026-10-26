/**
 * "Ask or tell me anything about <job>" — the box at the bottom of a job's
 * screen. DISABLED for now: another phase wires it to Ask. It is drawn anyway so
 * the layout is the one the founder picked and the box is where people will look
 * for it, and the note under it says plainly that it does not answer yet rather
 * than leaving a dead input to look broken.
 *
 * A real `<label>` (visually hidden) so the disabled control still has a name.
 */
export function JobGuideAskBox({ jobName }: { jobName: string }) {
  return (
    <div className="rounded-lg border border-line-card bg-surface p-3 print:hidden" data-guide="ask-box">
      <label htmlFor="guide-ask-box" className="sr-only">
        Ask or tell me anything about {jobName}
      </label>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-neutral-900"
        >
          AI
        </span>
        <input
          id="guide-ask-box"
          name="guideQuestion"
          type="text"
          disabled
          placeholder={`Ask or tell me anything about ${jobName}`}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line-card bg-canvas px-3 text-sm text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-80"
        />
        <button
          type="button"
          disabled
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">Asking from here is coming soon.</p>
    </div>
  );
}
