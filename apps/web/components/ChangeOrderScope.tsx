"use client";

import { useState, useTransition } from "react";
import {
  addChangeOrderScopeNote,
  removeChangeOrderScopeNote,
  updateChangeOrderScopeNote,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import {
  SCOPE_NOTE_HEADING,
  SCOPE_NOTE_HINT,
  SCOPE_NOTE_KINDS,
  type ScopeNoteKind,
} from "@/lib/change-order-scope";

/**
 * The scope half of a change order: what the price covers, what it does
 * NOT, and what it was figured on — each under its own heading.
 *
 * THE SEPARATION IS THE FEATURE, so it is structural here rather than
 * editorial. There is no code path in this file that can render an
 * exclusion inside the scope-of-work block: the sections come back from
 * `scopeSections()` already split by kind, each heading is read from
 * `SCOPE_NOTE_HEADING`, and a note is rendered only inside the section it
 * belongs to. `changeOrderScope.test.ts` mounts this and asserts it.
 *
 * Why that is worth a component rather than a paragraph: six months after a
 * PCO goes out, the GC says the temporary dance floor was in your number.
 * The defence is a document that says, under a heading called "NOT included
 * — by others", that it was not. The same sentence in the middle of a
 * description field is an argument instead of a term.
 */

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";
const primaryBtn =
  "rounded-md bg-brand px-3 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50";
const quietBtn =
  "rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50";

/** The same runner `ChangeOrders.tsx` uses, and for the same reason: these
 *  actions RETURN their refusals, and a plain `<form action={fn}>` throws
 *  the return value away, so production would render a dead button. */
function useActionRunner() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  return { isPending, error, run };
}

export type ScopeNoteView = {
  id: string;
  kind: ScopeNoteKind;
  text: string;
};

export type ScopeSectionView = {
  kind: ScopeNoteKind;
  heading: string;
  hint: string;
  notes: ScopeNoteView[];
};

export type LaborBreakoutView = {
  laborBase: string;
  foremanLines: { id: string; description: string; percent: string; amount: string; figuredAt: string }[];
  foreman: string;
  labor: string;
  material: string;
  subcontractor: string;
  other: string;
  uncategorized: string;
  adjustments: string;
  total: string;
  /** Sentences naming a foreman line that no longer matches the percentage
   *  it says it was figured at. Empty when they agree. */
  foremanOutOfStep: string[];
};

/** Which kinds show a coloured edge. An exclusion is the one a reader has
 *  to be unable to skim past, so it is the one that gets the strongest
 *  treatment on the page as well as its own heading. */
const SECTION_STYLE: Record<ScopeNoteKind, string> = {
  INCLUSION: "border-l-2 border-l-emerald-700",
  EXCLUSION: "border-l-2 border-l-rose-600",
  ASSUMPTION: "border-l-2 border-l-amber-600",
  PRICING_BASIS: "border-l-2 border-l-line-card",
};

const SECTION_HEADING_STYLE: Record<ScopeNoteKind, string> = {
  INCLUSION: "text-tag-green-ink",
  EXCLUSION: "text-tag-rose-ink",
  ASSUMPTION: "text-tag-amber-ink",
  PRICING_BASIS: "text-ink-label",
};

/**
 * The one shared field set, used by the add form and by the inline edit of
 * an existing note. One component so the two can never drift into offering
 * different kinds — which on this feature would mean an exclusion that can
 * be created and not corrected.
 */
function ScopeNoteFields({
  defaultKind,
  defaultText,
  idPrefix,
}: {
  defaultKind?: ScopeNoteKind;
  defaultText?: string;
  idPrefix: string;
}) {
  const [kind, setKind] = useState<ScopeNoteKind>(defaultKind ?? "EXCLUSION");

  return (
    <>
      <label className={labelClass} htmlFor={`${idPrefix}-kind`}>
        This sentence is
        <select
          id={`${idPrefix}-kind`}
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ScopeNoteKind)}
          className={`${inputClass} w-56`}
        >
          {SCOPE_NOTE_KINDS.map((k) => (
            <option key={k} value={k}>
              {SCOPE_NOTE_HEADING[k]}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass} htmlFor={`${idPrefix}-text`}>
        Wording, as it will appear to the GC
        <input
          id={`${idPrefix}-text`}
          name="text"
          required
          defaultValue={defaultText}
          className={`${inputClass} w-[28rem] max-w-full`}
          placeholder="Temporary dance floor to be provided by others"
        />
      </label>
      <p className="w-full text-xs text-ink-muted">{SCOPE_NOTE_HINT[kind]}</p>
    </>
  );
}

function ScopeNoteRow({ note, editable }: { note: ScopeNoteView; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const save = useActionRunner();
  const remove = useActionRunner();

  if (editing) {
    return (
      <li className="rounded-md border border-line-row bg-canvas p-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            save.run(() => updateChangeOrderScopeNote(note.id, formData), () => setEditing(false));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <ScopeNoteFields defaultKind={note.kind} defaultText={note.text} idPrefix={`note-${note.id}`} />
          <button type="submit" disabled={save.isPending} className={primaryBtn}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className={quietBtn}>
            Cancel
          </button>
          {save.error && <p className="w-full text-xs text-tag-rose-ink">{save.error}</p>}
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 text-sm text-ink-body">
      <span className="min-w-0 flex-1">{note.text}</span>
      {editable && (
        <span className="flex flex-col items-end gap-1">
          <RowActions
            className="flex shrink-0 items-center gap-2"
            as="span"
            destructive={
              <ConfirmDelete
                label="Remove"
                confirmLabel="Remove it"
                pendingLabel="Removing…"
                pinned="end"
                describe="Takes this sentence off the change order. An exclusion you remove is one the GC can later say was never claimed."
                armedClassName="flex items-center gap-2"
                pending={remove.isPending}
                onConfirm={() => remove.run(() => removeChangeOrderScopeNote(note.id))}
              />
            }
          >
            <button type="button" onClick={() => setEditing(true)} className={quietBtn}>
              Edit
            </button>
          </RowActions>
          {remove.error && <span className="text-xs text-tag-rose-ink">{remove.error}</span>}
        </span>
      )}
    </li>
  );
}

function AddScopeNote({ changeOrderId }: { changeOrderId: string }) {
  const [open, setOpen] = useState(false);
  const { isPending, error, run } = useActionRunner();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={quietBtn}>
        Add a scope note
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        run(() => addChangeOrderScopeNote(changeOrderId, formData), () => form.reset());
      }}
      className="flex flex-wrap items-end gap-3 rounded-md border border-line-row bg-canvas p-3"
    >
      <ScopeNoteFields idPrefix={`add-${changeOrderId}`} />
      <button type="submit" disabled={isPending} className={primaryBtn}>
        {isPending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className={quietBtn}>
        Done
      </button>
      {error && <p className="w-full text-xs text-tag-rose-ink">{error}</p>}
    </form>
  );
}

function BreakoutRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={muted ? "text-ink-muted" : "text-ink-body"}>{label}</span>
      <span className={`tabular-nums ${muted ? "text-ink-muted" : "text-ink-label"}`}>{value}</span>
    </div>
  );
}

/**
 * Labour against materials, with the foreman shown as what it was figured
 * at rather than as a bare number.
 *
 * The foreman row prints BOTH the priced amount and what the stored
 * percentage of the base labour comes to. They are usually the same, and
 * when they are not, that is a sentence a GC will produce later — so
 * `foremanOutOfStep` says so here, before the document goes out, instead of
 * the page quietly picking one of the two numbers to believe.
 */
function Breakout({ breakout }: { breakout: LaborBreakoutView }) {
  const rows: { label: string; value: string; muted?: boolean }[] = [
    { label: "Material", value: breakout.material },
    { label: "Subcontractor", value: breakout.subcontractor },
    { label: "Other", value: breakout.other },
    { label: "Not broken out", value: breakout.uncategorized, muted: true },
    { label: "Changes to existing scope", value: breakout.adjustments, muted: true },
  ].filter((row) => !/^[−-]?\$0\.00$/.test(row.value));

  return (
    <div className="mt-3 rounded-md border border-line-row bg-canvas p-3 text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        How this price is made up
      </p>
      <div className="flex flex-col gap-1">
        <BreakoutRow label="Labour — crew" value={breakout.laborBase} />
        {breakout.foremanLines.map((line) => (
          <div key={line.id} className="flex flex-col">
            <BreakoutRow label={`Labour — ${line.description} @ ${line.percent}%`} value={line.amount} />
            <span className="text-xs text-ink-muted">
              {line.percent}% of {breakout.laborBase} is {line.figuredAt}
            </span>
          </div>
        ))}
        <BreakoutRow label="Labour subtotal" value={breakout.labor} />
        {rows.map((row) => (
          <BreakoutRow key={row.label} label={row.label} value={row.value} muted={row.muted} />
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line-row pt-1 font-medium">
          <span className="text-ink">Change order total</span>
          <span className="tabular-nums text-ink">{breakout.total}</span>
        </div>
      </div>
      {breakout.foremanOutOfStep.map((message) => (
        <p key={message} className="mt-2 text-xs text-tag-amber-ink">
          {message}
        </p>
      ))}
    </div>
  );
}

export function ChangeOrderScope({
  changeOrderId,
  sections,
  breakout,
  editable,
  /** True when nothing on this change order is excluded or qualified. Only
   *  nudged on a draft — once it is sent, saying so changes nothing and
   *  just puts a warning on a document that is already out. */
  missingDefence,
}: {
  changeOrderId: string;
  sections: ScopeSectionView[];
  breakout: LaborBreakoutView;
  editable: boolean;
  missingDefence: boolean;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {sections.length === 0 ? (
        <p className="text-xs text-ink-muted">
          No scope notes yet. What the GC or another trade has to provide belongs here — it is what
          stops them arguing later that it was in your price.
        </p>
      ) : (
        sections.map((section) => (
          <section
            key={section.kind}
            data-scope-section={section.kind}
            className={`pl-3 ${SECTION_STYLE[section.kind]}`}
          >
            <h4
              className={`text-xs font-semibold uppercase tracking-wide ${SECTION_HEADING_STYLE[section.kind]}`}
            >
              {section.heading}
            </h4>
            <ul className="mt-1 flex flex-col gap-1">
              {section.notes.map((note) => (
                <ScopeNoteRow key={note.id} note={note} editable={editable} />
              ))}
            </ul>
          </section>
        ))
      )}

      {editable && missingDefence && (
        <p className="text-xs text-tag-amber-ink">
          Nothing on this change order is excluded or qualified. If the GC is providing anything —
          access, a lift, a floor, another trade&apos;s work — say so before you send it.
        </p>
      )}

      {editable && <AddScopeNote changeOrderId={changeOrderId} />}

      <Breakout breakout={breakout} />
    </div>
  );
}
