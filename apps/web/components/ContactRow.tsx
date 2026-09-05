"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteContact } from "@/lib/actions";
import { CONTACT_STATUS_OPTIONS, CONTACT_TYPE_OPTIONS } from "@/components/ContactFields";
import { ConfirmDelete, RowActions } from "@/components/RowActions";

const STATUS_STYLE: Record<string, string> = {
  PROSPECT: "bg-slate-800 text-slate-300",
  ACTIVE: "bg-green-500/15 text-green-300",
  INACTIVE: "bg-slate-800 text-slate-500",
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";

export function ContactRow({
  contact,
  canDelete,
}: {
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
    accountType: string | null;
    jobCount: number;
    openBidCount: number;
  };
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/contacts/${contact.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-slate-100">{contact.name}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[contact.status]}`}>
                {CONTACT_STATUS_OPTIONS.find((o) => o.value === contact.status)?.label ?? contact.status}
              </span>
              {contact.accountType && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  {CONTACT_TYPE_OPTIONS.find((o) => o.value === contact.accountType)?.label ?? contact.accountType}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400">{contact.email ?? contact.phone ?? "No contact info"}</p>
          </div>
        </Link>
        <div className="shrink-0 text-right text-sm text-slate-400">
          <p>
            {contact.jobCount} {contact.jobCount === 1 ? "job" : "jobs"}
          </p>
          {contact.openBidCount > 0 && (
            <p className="text-xs text-blue-400">
              {contact.openBidCount} open {contact.openBidCount === 1 ? "bid" : "bids"}
            </p>
          )}
        </div>
      </div>

      {canDelete && (
        <RowActions
          className="flex items-center gap-2"
          destructive={
            <ConfirmDelete
              prompt={`Delete ${contact.name}?`}
              pendingLabel="Deleting…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await deleteContact(contact.id);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.refresh();
                  } catch {
                    setError("Could not delete the contact");
                  }
                });
              }}
              deleteClassName={btn}
              cancelClassName={btn}
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            />
          }
        />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </li>
  );
}
