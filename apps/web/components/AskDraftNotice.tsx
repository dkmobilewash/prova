/**
 * Shown by a page opened with `?draft=` for a card it could not load.
 *
 * A person who tapped "Open the RFI form" on the dashboard and lands on a
 * blank form has no way to tell a bug from an expired card, so the page
 * says which it is. It cannot say WHICH of the reasons applied — the
 * loader answers null for all of them on purpose, so a card id in a URL
 * discloses nothing about whose it was — and the sentence lists them
 * rather than guessing. Styled to the field pages it sits on, not to the
 * dashboard's card.
 */
export function AskDraftNotice({ what }: { what: string }) {
  return (
    <p
      className="mb-4 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-400"
      data-ask="draft-missing"
    >
      The {what} you started from the Ask box isn&apos;t available any more. A card lasts half an hour,
      is only yours, and opens once. The form below is blank — type it here, or ask again from the
      dashboard.
    </p>
  );
}
