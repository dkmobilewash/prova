import Link from "next/link";

/** Where craft classifications come from, shown under a "Craft
 * classification" picker that has none to offer.
 *
 * Found on a preview: the time-entry and dispatch pickers could only say
 * "No craft tag", and nothing on the screen said classifications exist,
 * matter (an untagged hour cannot be priced for fringe or counted toward a
 * ratio), or where to add one. The setup lives at the bottom of
 * /union-compliance, which is what `#setup` scrolls to.
 *
 * Renders nothing when there are classifications, so callers can mount it
 * unconditionally beside the select. */
export function NoCraftsHint({ craftCount }: { craftCount: number }) {
  if (craftCount > 0) return null;
  return (
    <span className="max-w-[16rem] text-xs font-normal text-ink-muted">
      No craft classifications yet. Add your local and its classifications under{" "}
      <Link href="/union-compliance#setup" className="text-link hover:underline">
        Union &amp; fringe
      </Link>
      .
    </span>
  );
}
