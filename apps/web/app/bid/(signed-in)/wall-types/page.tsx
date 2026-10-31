import Link from "next/link";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { loadWallTypesScreen } from "@/lib/wall-types-view";
import { CollapsedForm } from "@/components/CollapsedForm";
import { NewWallTypeForm, StarterWallTypesButton, WallTypeCard } from "@/components/WallTypes";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";
import { missingStarterTypes } from "@/lib/wall-type-starters";

export const metadata = { title: "Wall types" };

/**
 * C Stream Bid — the partition schedule. REAL in this build: the same loader
 * (`loadWallTypesScreen`) and the same components (`WallTypeCard`,
 * `NewWallTypeForm`, `StarterWallTypesButton`) as the CRM's `/wall-types`, so
 * a wall type edited here is the one the CRM prices from — same account, same
 * rows. None of those components draws a link.
 *
 * What differs from the CRM page, and why: no `PageHeader` (its breadcrumb is
 * `Home → /dashboard` and it imports the CRM nav), no `NoAccess` (its button is
 * `/dashboard`), and no `EmptyState` (it imports EmptyStateButtons, whose Ask
 * action pushes `/ask`). The empty state's one action points at Bid's own
 * price book instead of `/catalog`.
 */
export default async function BidWallTypesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  // The takeoff's "Create a wall type from this group" lands here with the
  // measured thickness, as on the CRM page.
  const query = (await searchParams) ?? {};
  const thicknessFromTakeoff = typeof query.thicknessIn === "string" && Number.isFinite(Number(query.thicknessIn)) ? Number(query.thicknessIn) : null;
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const { views, catalogOptions, craftOptions, defaultWastePercent } = await loadWallTypesScreen(context.company.id);
  // Same rule as the CRM page (#818): offered while any starter is missing —
  // but only Bid's trades' starters, not flooring, paint or concrete.
  const missingStarters = missingStarterTypes(views.map((type) => type.code), "bid").map((type) => type.code);

  return (
    <PageShell width="working">
      <h1 className="mb-1 font-headline text-3xl font-semibold text-ink">Wall types</h1>
      <p className="mb-6 max-w-3xl text-sm text-ink-body">
        Your partition schedule: each wall type by its drawing tag, and what goes into a foot of it. On an estimate
        each run of wall is entered by its type, length and height, and the lines are worked out from these. Link a
        part to your price book to price it, and give it your crew&rsquo;s rate to get the hours.
      </p>

      {views.length === 0 ? (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-5">
          <h2 className="text-lg font-semibold text-ink">No wall types yet</h2>
          <p className="max-w-prose text-sm text-ink-body">
            A floor plan tells you how many feet of wall there are. It does not tell you what the wall is or how tall
            — the partition schedule and the sections do. Put your wall types here once and every estimate&rsquo;s
            runs turn into studs, track and board by themselves.
          </p>
          <p className="text-sm text-ink-body">
            Parts price from your{" "}
            <Link href="/bid/price-book" className="text-link hover:text-link-hover hover:underline">
              price book
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="mb-6 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {views.map((type) => (
            <WallTypeCard
              key={type.id}
              type={type}
              catalog={catalogOptions}
              crafts={craftOptions}
              defaultWastePercent={defaultWastePercent}
            />
          ))}
        </ul>
      )}

      {/* Outside the empty/list branch, as on the CRM page: pressing it swaps
          that branch, and a button inside it would unmount with its "Added …"
          sentence. */}
      <StarterWallTypesButton missing={missingStarters} hasLibrary={views.length > 0} surface="bid" />

      <CollapsedForm label="Add wall type">
        <NewWallTypeForm initial={thicknessFromTakeoff === null ? undefined : { thicknessIn: thicknessFromTakeoff.toFixed(2) }} />
      </CollapsedForm>
    </PageShell>
  );
}
