"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteContactPerson, updateContactPerson } from "@/lib/actions";
import { ContactPersonFields } from "@/components/ContactPersonFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

export type ContactPersonRowData = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  /** Derived at read time from this person's interaction log -- see
   * lastContactByPersonId in the page. Never a stored field. */
  lastContactOn: string | null;
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function ContactPersonRow({ person }: { person: ContactPersonRowData }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
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
                const result = await updateContactPerson(person.id, formData);
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
          <ContactPersonFields defaults={person} />
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
            <p className="font-medium text-slate-100">{person.name}</p>
            {person.title && <span className="text-xs text-slate-500">{person.title}</span>}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {[person.email, person.phone].filter(Boolean).join(" · ") || "No email or phone on file"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {person.lastContactOn ? `Last contact ${person.lastContactOn}` : "No interactions logged with them yet"}
          </p>
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </div>

        {/* Arming the delete empties this row: "Edit" used to stay live next
            to the armed confirm, so a click meant for Cancel opened the edit
            form on a person who was one click from being gone. Everything
            ordinary is a child of RowActions and disappears while armed. */}
        <RowActions
          className="flex shrink-0 flex-wrap items-center gap-2"
          destructive={
            <ConfirmDelete
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await deleteContactPerson(person.id);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.refresh();
                  } catch {
                    setError("Could not delete them");
                  }
                });
              }}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            />
          }
        >
          <button type="button" disabled={isPending} onClick={() => setMode("edit")} className={btn}>
            Edit
          </button>
        </RowActions>
      </div>
    </li>
  );
}
