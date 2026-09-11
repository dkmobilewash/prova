"use client";

import { useState, useTransition } from "react";
import { testQuickBooksConnection } from "@/lib/actions";

export function QuickBooksTestConnectionButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      try {
        const info = await testQuickBooksConnection();
        setIsError(false);
        setResult(`Connected to "${info.companyName}"${info.country ? ` (${info.country})` : ""}.`);
      } catch (error) {
        setIsError(true);
        setResult(error instanceof Error ? error.message : "Connection test failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex w-fit items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-100 disabled:opacity-50"
      >
        {isPending ? "Testing…" : "Test connection"}
      </button>
      {result && (
        <p className={`text-sm ${isError ? "text-red-600" : "text-green-700"}`}>{result}</p>
      )}
    </div>
  );
}
