"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSalesLead } from "@/lib/actions";
import { SalesLeadFields, type SalesLeadDefaults } from "@/components/SalesLeadFields";
import { SubmitButton } from "@/components/SubmitButton";

export function SalesLeadEditForm({ leadId, defaults }: { leadId: string; defaults: SalesLeadDefaults }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await updateSalesLead(leadId, formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          } catch {
            setError("Could not save changes");
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <SalesLeadFields defaults={defaults} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <SubmitButton
        type="submit"
        disabled={isPending}
        className="mt-2 inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </SubmitButton>
    </form>
  );
}
