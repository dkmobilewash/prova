import { Spinner } from "@/components/Spinner";

/**
 * Rendered only inside the viewer (a client component), so it needs no directive of its own.
 *
 * "Erase walls in this area" (coordination/erase-area-tool.md E4): the box is drawn, nothing is written yet. The count is
 * every found wall the shared predicate takes (`eraseInBoxes`): the product cannot know which are real, so it never says
 * "real walls". A person who sees too much inside redraws smaller — the ceiling's refusal rule, handed to the person.
 */
export function eraseAreaQuestion(n: number, feet: number): string {
  if (n === 0) return "No found walls are wholly inside this box.";
  return `Erase ${n} wall${n === 1 ? "" : "s"}, ${Math.round(feet).toLocaleString("en-US")} ft?`;
}

export function EraseAreaConfirm({ n, feet, saving, onErase, onCancel }: { n: number; feet: number; saving: boolean; onErase: () => void; onCancel: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-takeoff="erase-area-confirm">
      <span className="font-medium text-ink-body">{eraseAreaQuestion(n, feet)}</span>
      {n > 0 && (
        <button type="button" disabled={saving} data-takeoff="erase-area-go" onClick={onErase} className="min-h-[32px] rounded-md bg-brand px-3 font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-60">
          {saving ? (
            <>
              <Spinner /> Erasing…
            </>
          ) : (
            "Erase"
          )}
        </button>
      )}
      <button type="button" disabled={saving} data-takeoff="erase-area-cancel" onClick={onCancel} className="min-h-[32px] rounded-md border border-line-card bg-surface px-3 text-ink-body disabled:opacity-60">
        Cancel
      </button>
    </div>
  );
}
