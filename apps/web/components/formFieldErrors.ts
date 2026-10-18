/**
 * Puts a returned `fieldErrors` record next to the inputs it names.
 *
 * DOM-level on purpose: every ActionForm caller renders its fields through
 * its own `*Fields` component, and none of them would have to change to get
 * a message under the right box. The message is a node this module owns
 * (`data-field-error`), appended INSIDE the field's `<label>` when there is
 * one — a sibling after the label would become a stray grid cell in the
 * two-column date rows — and after the control otherwise. React leaves a
 * foreign trailing child alone; `clearFieldErrors` removes it again.
 *
 * Returns the first invalid control in form order, so the caller can focus
 * it. A name that matches no control (or only a hidden one) is skipped, and
 * the form-level sentence still says it.
 */
const MARK = "data-field-error";
let sequence = 0;

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controlsNamed(form: HTMLFormElement, name: string): Control[] {
  return Array.from(form.elements).filter(
    (el): el is Control =>
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
      el.name === name &&
      el.type !== "hidden",
  );
}

export function showFieldErrors(form: HTMLFormElement, errors: Record<string, string>): Control | null {
  clearFieldErrors(form);
  let first: Control | null = null;
  for (const [name, message] of Object.entries(errors)) {
    const controls = controlsNamed(form, name);
    if (controls.length === 0) continue;
    const id = `field-error-${++sequence}`;
    const note = document.createElement("span");
    note.setAttribute(MARK, name);
    note.id = id;
    note.className = "block text-sm font-medium text-tag-rose-ink";
    note.textContent = message;
    for (const control of controls) {
      control.setAttribute("aria-invalid", "true");
      const describedBy = control.getAttribute("aria-describedby");
      control.setAttribute("aria-describedby", describedBy ? `${describedBy} ${id}` : id);
    }
    // A radio group's last option is where its message reads naturally.
    const anchor = controls[controls.length - 1]!;
    const label = anchor.closest("label");
    if (label && form.contains(label)) label.appendChild(note);
    else anchor.after(note);
    for (const control of controls) {
      if (!first || first.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING) first = control;
    }
  }
  return first;
}

/**
 * The one line a hand-rolled `onSubmit` form adds after its action returns:
 * shows a refusal's `fieldErrors` (or clears the last ones on success) and
 * focuses the first bad field. `ActionForm` does this itself.
 */
export function reportFieldErrors(
  form: HTMLFormElement | null | undefined,
  result: { ok: boolean; fieldErrors?: Record<string, string> } | void,
) {
  if (!form) return;
  showFieldErrors(form, (result && !result.ok && result.fieldErrors) || {})?.focus();
}

/** Removes every message and `aria-invalid` this module added. With a
 * `name`, only that field's — called as the person edits it. */
export function clearFieldErrors(form: HTMLFormElement, name?: string) {
  const selector = name === undefined ? `[${MARK}]` : `[${MARK}="${CSS.escape(name)}"]`;
  for (const note of Array.from(form.querySelectorAll(selector))) {
    for (const control of Array.from(form.querySelectorAll(`[aria-describedby~="${note.id}"]`))) {
      const rest = (control.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter((token) => token && token !== note.id)
        .join(" ");
      if (rest) control.setAttribute("aria-describedby", rest);
      else control.removeAttribute("aria-describedby");
      control.removeAttribute("aria-invalid");
    }
    note.remove();
  }
}
