import type { ScopeSection } from "@/lib/change-order-scope";

/**
 * A change order's scope, read-only, with each kind under its own heading.
 *
 * WHY THIS EXISTS AS ITS OWN COMPONENT, because the alternative looked
 * fine and was not. The scope notes are rendered in two places: the sub's
 * own change-order section, and the GC's copy in the portal. The sub's is
 * `ChangeOrderScope`, which is `"use client"` and carries add/edit/remove
 * actions — the portal cannot use it and should not, since the GC edits
 * nothing. So the portal hand-rolled its own div/p/ul/li.
 *
 * Both called `scopeSections()`, so the SPLIT was shared. The RENDERING was
 * not, and the rendering is where the feature lives: this module's own rule
 * is that THE HEADINGS ARE THE FEATURE. A review proved the gap by deleting
 * the portal's `{section.heading}` and then flattening every kind into one
 * undifferentiated bulleted list — **all 3,215 tests stayed green, on the
 * one copy where a GC reads it.** The committed code was correct; nothing
 * guarded it.
 *
 * The cause was that the portal's tests were source-text greps —
 * `toContain("scopeSections(co.scopeNotes)")` answers "is the splitter
 * called", not "does the GC's copy keep the kinds apart". That is the exact
 * family CLAUDE.md catalogues: a check that is green about a question
 * nobody asked.
 *
 * So the portal renders THIS, and this is mounted and asserted against.
 * Deliberately a SERVER component with no state, no actions and no client
 * boundary — the portal is a signed-out page and nothing here needs to be
 * interactive for a reader.
 *
 * WHY EXCLUSIONS ARE THE POINT: "temporary dance floor to be provided by
 * others" is what stops a GC later arguing an item was inside the price. An
 * exclusion folded into the scope of work is not a cosmetic regression on
 * this surface — it is the sub losing the argument.
 */
export function ScopeSectionList({
  sections,
  className,
}: {
  sections: ScopeSection[];
  className?: string;
}) {
  if (sections.length === 0) return null;

  return (
    <div className={className}>
      {sections.map((section) => (
        <div key={section.kind} className="mt-2">
          <p
            className="text-xs font-semibold uppercase tracking-wide text-ink-label"
            data-scope-heading={section.kind}
          >
            {section.heading}
          </p>
          <ul className="mt-1 list-disc pl-5 text-ink-body">
            {section.notes.map((note) => (
              <li key={note.id} data-scope-kind={section.kind}>
                {note.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
