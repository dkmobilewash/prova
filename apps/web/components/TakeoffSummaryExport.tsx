/**
 * Two downloads of the takeoff summary — quantities only, no prices. Plain
 * links to the Route Handler, so one click saves the file; shown only when
 * the company's `takeoffExportOn` switch is on (the page decides).
 */
export function TakeoffSummaryExport({ jobId }: { jobId: string }) {
  const href = (format: "csv" | "pdf") => `/api/takeoff-summary?jobId=${encodeURIComponent(jobId)}&format=${format}`;
  const button = "inline-flex min-h-[40px] items-center rounded-md bg-rail-hover px-3 text-sm font-medium text-ink hover:bg-lift";
  return (
    <div data-takeoff="summary-export" className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">Takeoff summary, quantities only:</span>
      <a href={href("csv")} download className={button} data-takeoff="summary-csv">
        Download CSV
      </a>
      <a href={href("pdf")} download className={button} data-takeoff="summary-pdf">
        Download PDF
      </a>
    </div>
  );
}
