import Link from "next/link";
import { zeroedLinesSentence } from "@/lib/estimating/zeroedLinesWords";

/**
 * ── THE PRICED LINES WHOSE WALLS ARE GONE, SAID ON EVERY SCREEN THAT CAN CAUSE IT (order (e), A2) ──
 *
 * Rendered from `zeroedPricedLines` on each load of the takeoff tab, the takeoff workspace and the estimate, so it
 * follows whichever action took a line to 0, including a background job with no screen. Nothing is stored: it says
 * what is true, and goes when the line is removed or its walls come back.
 */
export function ZeroedLinesNotice({
  jobId,
  lines,
  floating = false,
  onEstimate = false,
}: {
  jobId: string;
  lines: readonly { id: string; description: string; unitPrice: string | null }[];
  floating?: boolean;
  onEstimate?: boolean;
}) {
  if (lines.length === 0) return null;
  return (
    <p
      role="status"
      data-zeroed-lines={lines.length}
      className={`${floating ? "fixed bottom-4 left-4 z-40 max-w-md shadow-lg" : ""} rounded-md border border-tag-amber bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink`}
    >
      {zeroedLinesSentence(lines)}{" "}
      {onEstimate ? (
        "Remove a line below, or leave it for when the walls come back."
      ) : (
        <Link href={`/jobs/${jobId}/estimate`} className="font-medium underline">
          Remove it on the estimate, or leave it for when the walls come back.
        </Link>
      )}
    </p>
  );
}
