import { DAS_UNVERIFIED_FOR_COUNSEL } from "@/lib/das-forms";

/**
 * Every DAS rule in this app that nobody has read off a primary DIR page.
 *
 * ON THE SCREEN, collapsed, rather than buried in a source comment. The
 * precedent is a scar: FEATURE-AUDIT.md records that the prevailing-wage
 * determination rule was "located by web search and not yet clicked through to
 * the primary pages by a human", and that sentence lives in a file a
 * contractor never opens. A deadline shown with confidence, sourced from a
 * blog post that summarised a regulation, is exactly the fabrication this area
 * exists to refuse — the only honest version is to show the deadline AND show
 * that it is unconfirmed, in the same place.
 *
 * Renders nothing when the list empties, which is what happens when somebody
 * flips the citations in `lib/das-forms.ts` to verified. It cannot go stale in
 * the other direction because the list is derived from that table.
 */
export function DasUnverifiedNote() {
  if (DAS_UNVERIFIED_FOR_COUNSEL.length === 0) return null;

  return (
    <details className="mt-4 rounded-lg border border-line-card bg-surface p-3">
      <summary className="cursor-pointer text-xs text-tag-amber-ink">
        {DAS_UNVERIFIED_FOR_COUNSEL.length} rules behind these deadlines have NOT been confirmed
        against DIR — read this before you rely on a date
      </summary>
      <p className="mt-2 text-xs text-ink-muted">
        Every rule below was found by web search and read at one remove, from guidance that
        summarises the regulation rather than from the regulation. None of it has been clicked through
        to DIR&rsquo;s own pages by a person. The deadlines on this screen are worth having and are not
        worth betting a penalty on: take this list to counsel, and when a rule is confirmed it stops
        appearing here.
      </p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {DAS_UNVERIFIED_FOR_COUNSEL.map((citation) => (
          <li key={citation.key} className="text-xs leading-snug">
            <p className="text-ink-label">{citation.claim}</p>
            <p className="text-ink-muted">
              {citation.authority} ·{" "}
              <a
                href={citation.primaryUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                the page that would settle it
              </a>
            </p>
            <p className="text-tag-amber-ink/80">Ask: {citation.question}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
