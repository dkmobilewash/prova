"use client";

import { useState, useTransition } from "react";
import { checkAssistantConnection } from "@/lib/actions/ask";

/**
 * One button on Settings → Assistant. The action returns a sentence either
 * way, so what the owner reads is the API's own answer translated, never
 * a thrown message production would redact.
 */
export function AssistantConnectionCheck() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const outcome = await checkAssistantConnection();
      setResult(
        outcome.ok
          ? { ok: true, text: `Connected. The key works and this organization can use ${outcome.value.model}.` }
          : { ok: false, text: outcome.error },
      );
    });
  }

  return (
    <div className="flex flex-col gap-2" data-ask="connection-check">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex w-fit items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Checking…" : "Check connection"}
      </button>
      {result && <p className={`text-sm ${result.ok ? "text-green-400" : "text-red-400"}`}>{result.text}</p>}
    </div>
  );
}
