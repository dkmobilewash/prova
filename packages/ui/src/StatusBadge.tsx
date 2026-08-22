const STYLES: Record<string, string> = {
  ESTIMATE: "bg-slate-100 text-slate-700",
  CONTRACTED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-800",
  COMPLETE: "bg-green-100 text-green-700",
};

const LABELS: Record<string, string> = {
  ESTIMATE: "Estimate",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-100 text-slate-700";
  const label = LABELS[status] ?? status;

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
