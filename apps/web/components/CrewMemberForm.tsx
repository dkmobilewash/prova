"use client";

import { useState, useTransition } from "react";
import { createCrewMember } from "@/lib/actions";
import { CrewMemberFields, type CrewCraftOption } from "@/components/CrewMemberFields";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

/**
 * Adding one person to the crew, by name, with no email and no login.
 *
 * Collapsed by default, same as `EquipmentForm` and `VendorForm`: the list
 * is why you came, adding is occasional. It is NOT collapsed away from the
 * empty state — `CrewRoster` opens straight onto this button when there is
 * nobody on the crew yet, because the whole defect this replaces was an add
 * affordance that only appeared once a record existed.
 *
 * `onSubmit` rather than `<form action={fn}>`: React 19 resets a form given
 * to the `action` prop BEFORE the action has answered, so a refusal would
 * be rendered beside fields that had already snapped back to blank
 * (`formActionCensus.test.ts`). Reset happens on the ok branch only.
 */
export function CrewMemberForm({
  craftOptions,
  canSetCraft,
  autoFocusOpen = false,
}: {
  craftOptions: CrewCraftOption[];
  canSetCraft: boolean;
  /** Opened already, for the empty state — there is nothing else on the
   *  screen to look at, so a button that only reveals a form is a step for
   *  no reason. */
  autoFocusOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(autoFocusOpen);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const draft = useFormDraft("crew:create");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAdded(null);
    const formData = new FormData(event.currentTarget);
    const name = [formData.get("legalFirstName"), formData.get("legalLastName")]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    startTransition(async () => {
      const result = await createCrewMember(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      draft.clear();
      draft.resetForm();
      // Left OPEN, unlike every other add form in this app. Crew is entered
      // off one sheet in one sitting — fifteen names in a row — and closing
      // the form after each one turns a list into fifteen button presses.
      // The confirmation line is what says the last one landed, since the
      // fields it was typed into are now blank again.
      setAdded(name || "That crew member");
    });
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Add a crew member
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line-card bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-ink-label">Add a crew member</h3>
      <p className="mb-3 text-xs text-ink-muted">
        Their name is all that&apos;s needed. They don&apos;t get a login and nothing is emailed to
        them.
      </p>
      <form ref={draft.formRef} onSubmit={handleSubmit} onChange={draft.save} className="flex flex-col gap-3">
        <FormDraftNotice draft={draft} />
        <CrewMemberFields craftOptions={craftOptions} canSetCraft={canSetCraft} />

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {added && (
          <p role="status" className="text-sm text-emerald-300">
            {added} is on the crew. Type the next one.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add to crew"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setIsOpen(false);
              setError(null);
              setAdded(null);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </form>
    </div>
  );
}
