"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteContactInteraction, updateContactInteraction } from "@/lib/actions";
import {
  ContactInteractionFields,
  INTERACTION_TYPE_OPTIONS,
  type MemberOption,
  type PersonOption,
} from "@/components/ContactInteractionFields";

export type ContactInteractionRowData = {
  id: string;
  type: string;
  occurredOn: string;
  summary: string;
  followUpOn: string | null;
  followUpAssignedToUserId: string | null;
  followUpAssignedToUserName: string | null;
  loggedByUserName: string | null;
  contactPersonId: string | null;
  contactPersonName: string | null;
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function ContactInteractionRow({
  interaction,
  members,
  people,
}: {
  interaction: ContactInteractionRowData;
  members: MemberOption[];
  people: PersonOption[];
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              try {
                const result = await updateContactInteraction(interaction.id, formData);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
                setMode("view");
              } catch {
                setError("Could not save changes");
              }
            });
          }}
          className="flex flex-col gap-3"
        >
          <ContactInteractionFields members={members} people={people} defaults={interaction} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode("view")} className={btn}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
              {INTERACTION_TYPE_OPTIONS.find((o) => o.value === interaction.type)?.label ?? interaction.type}
            </span>
            <span className="text-xs text-slate-500">{interaction.occurredOn}</span>
            {interaction.contactPersonName && (
              <span className="text-xs text-slate-500">with {interaction.contactPersonName}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-300">{interaction.summary}</p>
          {interaction.followUpOn && (
            <p className="mt-1 text-xs text-amber-300">
              Follow up {interaction.followUpOn}
              {interaction.followUpAssignedToUserName && ` — ${interaction.followUpAssignedToUserName}`}
            </p>
          )}
          {interaction.loggedByUserName && (
            <p className="mt-1 text-xs text-slate-500">logged by {interaction.loggedByUserName}</p>
          )}
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
            Edit
          </button>
          {isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await deleteContactInteraction(interaction.id);
                      if (!result.ok) {
                        setError(result.error);
                        setIsConfirmingDelete(false);
                        return;
                      }
                      router.refresh();
                    } catch {
                      setError("Could not delete it");
                      setIsConfirmingDelete(false);
                    }
                  });
                }}
                className="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setIsConfirmingDelete(false)} className={btn}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" disabled={isPending} onClick={() => setIsConfirmingDelete(true)} className={btn}>
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
