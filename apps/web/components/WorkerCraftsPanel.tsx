"use client";

import { useState, useTransition } from "react";
import { setWorkerCraft } from "@/lib/actions";
import type { WorkerCraftPerson } from "@/lib/union-compliance-query";

/**
 * Who works under each craft — one row per person, one checkbox per craft.
 * Each box saves on its own; there is no form to submit. It only narrows
 * the phone's craft picker for that person (a person with no boxes ticked
 * sees every craft), so an unticked box never blocks anyone from logging.
 */
export function WorkerCraftsPanel({
  people,
  crafts,
}: {
  people: WorkerCraftPerson[];
  crafts: { id: string; label: string }[];
}) {
  // Local copy so a click shows at once; the server action revalidates the
  // page and the next render replaces it.
  const [assigned, setAssigned] = useState(
    () => new Set(people.flatMap((p) => p.craftIds.map((id) => `${p.key}|${id}`))),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (crafts.length === 0) {
    return (
      <div className="rounded-lg border border-line-card bg-surface p-4">
        <p className="text-sm text-ink-label">No craft classifications yet.</p>
        <p className="mt-2 text-xs text-ink-muted">
          Add them under a local below, then tick who works under each one here.
        </p>
      </div>
    );
  }
  if (people.length === 0) {
    return (
      <div className="rounded-lg border border-line-card bg-surface p-4">
        <p className="text-sm text-ink-label">Nobody to set up yet — no team members or crew.</p>
      </div>
    );
  }

  const toggle = (personKey: string, craftId: string, enabled: boolean) => {
    const cell = `${personKey}|${craftId}`;
    const next = new Set(assigned);
    if (enabled) next.add(cell);
    else next.delete(cell);
    setAssigned(next);
    setError(null);
    startTransition(async () => {
      const result = await setWorkerCraft(craftId, personKey, enabled);
      if (!result.ok) {
        // Put the box back the way the server still has it.
        setAssigned((current) => {
          const reverted = new Set(current);
          if (enabled) reverted.delete(cell);
          else reverted.add(cell);
          return reverted;
        });
        setError(result.error);
      }
    });
  };

  return (
    <div className="rounded-lg border border-line-card bg-surface p-4">
      {error && <p className="mb-3 text-sm text-tag-rose-ink">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1.5 pr-4 font-medium">Person</th>
              {crafts.map((craft) => (
                <th key={craft.id} className="px-2 py-1.5 text-center font-medium">
                  {craft.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.key} className="border-t border-line-row">
                <td className="py-1.5 pr-4">
                  {person.label}
                  {person.kind === "crew" && <span className="ml-2 text-xs text-ink-muted">crew</span>}
                </td>
                {crafts.map((craft) => {
                  const checked = assigned.has(`${person.key}|${craft.id}`);
                  return (
                    <td key={craft.id} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${person.label} works as ${craft.label}`}
                        checked={checked}
                        disabled={pending}
                        onChange={(event) => toggle(person.key, craft.id, event.target.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
