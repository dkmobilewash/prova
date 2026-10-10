### A form now says which box is wrong, and asks before you walk away from it (Cyrus)
`cyrus/ui-forms`

Contractors called the app "too hard to use", and two of the reasons were
in every form. A refusal was one sentence at the bottom of the form, with
nothing marking which box it meant. And nothing warned before you left a
half-filled form, so a tap on a job chip threw the typing away.

**Field errors.** A failed action may now return
`fieldErrors: { [inputName]: message }` next to `error`. Every plain
`{ ok: false, error }` still works unchanged. `InputError` takes an optional
field name, and `runAction` turns it into `fieldErrors`. The shared parsers
pass their key: the number readers, `enumFromForm`, `optionalEnumFromForm`
and `optionalLinkOrThrow`. So every `runAction` action that uses them gets
per-field errors with no edit of its own. `ActionForm` puts each message
inside that field's `<label>`, sets `aria-invalid` and `aria-describedby`,
and focuses the first bad field in form order. The bottom sentence stays as
`role="alert"`. When no field matched, that sentence is scrolled into view.
Hand-rolled `onSubmit` forms can add one line, `reportFieldErrors(form, result)`.

Converted: the submittals action and `SubmittalForm` (the worked example),
`createJob` and `NewJobForm`, `addLineItem`'s description, change-order
titles (`createChangeOrder` and the propose forms, through
`useActionRunner`), and time-entry hours/per diem/travel pay on both the
log form and the correction form.

**Not losing work.** Once something has been typed in an `ActionForm`,
closing or reloading the tab, or clicking an in-app link, asks first. The
prompt stops after a successful save. `draftKey` opts a form into the
existing `useFormDraft`. That is still sessionStorage, not localStorage,
for the reason `formDraft.ts` gives: an old draft must not come back days
later into an evidence record. Password, file and hidden inputs are never
stored.

The check is `components/actionFormFieldErrors.test.ts`. It was
mutation-tested by deleting the focus call, the "saved" release, the draft
clear and the "dirty" mark, and each deletion turned a test red. It was
also clicked in headless Chromium on a scratch page (since deleted) holding
the real `SubmittalFields`.
