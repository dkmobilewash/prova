"use client";

import { useCallback, useRef, useState } from "react";
import {
  applyDraftValues,
  clearDraft,
  collectDraftValues,
  readDraft,
  writeDraft,
  type DraftStore,
  type DraftValues,
} from "@/components/formDraft";

/**
 * Draft persistence for a form — the DOM half of `formDraft.ts` (#239).
 *
 * Wire-up is three attributes and one call:
 *
 *     const draft = useFormDraft(`punch-list:edit:${item.id}`);
 *     <form ref={draft.formRef} onChange={draft.save} onSubmit={…}>
 *       <FormDraftNotice draft={draft} />
 *       …
 *     // and in the submit handler, after the action succeeds:
 *     draft.clear();
 *
 * The draft key must carry the row's identity for an edit form (the id),
 * so two rows' edit forms can never trade drafts, and the page/job
 * context for a create form that appears in more than one place.
 *
 * `onChange` on the <form> element is the only listener: React's onChange
 * is the bubbled input event, so one prop on the form hears every field.
 * Nothing global, nothing on window or document — deliberately, per
 * CLAUDE.md's rule — which also means a form that never fires a change
 * never writes a byte.
 *
 * Restore runs when the form ELEMENT attaches (`formRef` is a callback
 * ref), never during render: these components are server-rendered first,
 * and a render that read storage would hydrate against markup the server
 * could not have produced. A callback ref rather than an effect because
 * most of these forms are collapsed behind an "Add …" button — the form
 * mounts long after the component does, and an on-mount effect would run
 * against no form and never look again. Uncontrolled fields (the norm
 * here — the `*Fields` components) are written directly; a form with a
 * controlled field passes `onRestore` to sync its state, and `onDiscard`
 * to reset it when the user throws the draft away.
 */
export function useFormDraft(
  draftKey: string,
  options?: {
    /** Called after a stored draft was applied, with the stored values —
     * sync any controlled-field state here. */
    onRestore?: (values: DraftValues) => void;
    /** Called after an explicit discard, once the form has been reset —
     * reset any controlled-field state here. */
    onDiscard?: () => void;
  },
) {
  const formElement = useRef<HTMLFormElement | null>(null);
  const [restored, setRestored] = useState(false);
  // Ref'd so the callbacks below never change identity (and re-restore)
  // because a caller passed a fresh options object on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** Pass as the form's `ref`. Fires with the element on every mount of
   * the <form> — including a collapsed form opening, or a row entering
   * edit mode — which is exactly when a waiting draft should come back. */
  const formRef = useCallback(
    (form: HTMLFormElement | null) => {
      formElement.current = form;
      if (!form) return;
      const values = readDraft(sessionStore(), draftKey);
      if (!values) return;
      const applied = applyDraftValues(controlsOf(form), values);
      optionsRef.current?.onRestore?.(values);
      // A draft that changed nothing (every value already the default,
      // and no controlled fields to sync) is not worth a notice — but it
      // is still cleared on submit like any other.
      if (applied > 0 || optionsRef.current?.onRestore) setRestored(true);
    },
    [draftKey],
  );

  /** Pass as the form's onChange. Serializes the whole form on every
   * change; these forms are a dozen small fields, so this is cheap. */
  const save = useCallback(() => {
    const form = formElement.current;
    if (!form) return;
    writeDraft(sessionStore(), draftKey, collectDraftValues(controlsOf(form)));
  }, [draftKey]);

  /** Call when the action reported success — the draft did its job. */
  const clear = useCallback(() => {
    clearDraft(sessionStore(), draftKey);
    setRestored(false);
  }, [draftKey]);

  /** Put the fields back to their server-rendered defaults. For callers
   * that used to keep their own ref just to call `form.reset()`. */
  const resetForm = useCallback(() => {
    formElement.current?.reset();
  }, []);

  /** The notice's "Discard" — forget the draft AND put the form back to
   * its server-rendered defaults, so what's on screen matches what's
   * stored (nothing). */
  const discard = useCallback(() => {
    clearDraft(sessionStore(), draftKey);
    formElement.current?.reset();
    optionsRef.current?.onDiscard?.();
    setRestored(false);
  }, [draftKey]);

  /** The notice's "Dismiss" — hide the sentence, keep the restored text. */
  const dismiss = useCallback(() => setRestored(false), []);

  return { formRef, restored, save, clear, resetForm, discard, dismiss };
}

export type FormDraft = ReturnType<typeof useFormDraft>;

/**
 * The sentence a form shows when a draft came back, styled like
 * AskDraftNotice (a plain bordered note, no toast). Renders nothing until
 * a restore actually changed something.
 */
export function FormDraftNotice({ draft }: { draft: FormDraft }) {
  if (!draft.restored) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-card bg-canvas px-3 py-2"
      data-draft="restored"
    >
      <p className="text-sm text-ink-label">
        Brought back what you&apos;d typed here earlier — it was never saved.
      </p>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={draft.discard}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-100"
        >
          Discard it
        </button>
        <button
          type="button"
          onClick={draft.dismiss}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-sm text-ink-label hover:bg-neutral-100"
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}

function sessionStore(): DraftStore | null {
  // The accessor itself can throw (browsers set to block site data), not
  // just the methods — so even reaching for it is guarded.
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function controlsOf(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement,
  );
}
