"use client";

import { useState, useTransition } from "react";
import { loadTakeoffExport } from "@/lib/actions";
import { exportCsv, exportTabs } from "@/lib/takeoff/takeoffExport";

const fileStem = (name: string) => `${name.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "job"}-takeoff`;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The takeoff as a file, built here in the browser from what the server reads. Nothing is stored. */
export function TakeoffExportButtons({ jobId }: { jobId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (format: "csv" | "xlsx") =>
    startTransition(async () => {
      setError(null);
      const result = await loadTakeoffExport(jobId);
      if (!result.ok) return setError(result.error);
      if (result.value.rows.length === 0) return setError("Nothing is measured on this job yet.");
      const stem = fileStem(result.value.jobName);
      if (format === "csv") return save(new Blob([exportCsv(result.value.rows)], { type: "text/csv" }), `${stem}.csv`);
      const XLSX = await import("xlsx");
      const book = XLSX.utils.book_new();
      for (const tab of exportTabs(result.value)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(tab.rows), tab.name);
      const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      save(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${stem}.xlsx`);
    });
  return (
    <div className="mt-1.5" data-takeoff="takeoff-export">
      <div className="flex gap-1.5">
        <button type="button" onClick={() => run("xlsx")} disabled={pending} data-takeoff="export-xlsx" className="flex-1 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover disabled:opacity-50">
          Download Excel
        </button>
        <button type="button" onClick={() => run("csv")} disabled={pending} data-takeoff="export-csv" className="flex-1 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover disabled:opacity-50">
          Download CSV
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
