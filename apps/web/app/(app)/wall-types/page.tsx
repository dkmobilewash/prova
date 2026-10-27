import { PageHeader } from "@/components/PageHeader";
import { CollapsedForm } from "@/components/CollapsedForm";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { EmptyState } from "@/components/EmptyState";
import { NewWallTypeForm, StarterWallTypesButton, WallTypeCard } from "@/components/WallTypes";
import { loadWallTypesScreen } from "@/lib/wall-types-view";
import { missingStarterTypes } from "@/lib/wall-type-starters";

/**
 * The company's partition schedule — every wall type it builds, and what each
 * one is made of. A job's wall runs are priced from these; editing one here
 * changes an existing estimate only when that job's schedule is refreshed.
 */
export default async function WallTypesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  // "Create a wall type from this group" on the takeoff lands here with the
  // measured thickness, so the one number the drawing gave is not retyped.
  const query = (await searchParams) ?? {};
  const thicknessFromTakeoff = typeof query.thicknessIn === "string" && Number.isFinite(Number(query.thicknessIn)) ? Number(query.thicknessIn) : null;
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;

  // Shared with C Stream Bid's /bid/wall-types — see lib/wall-types-view.ts.
  const { views, catalogOptions, craftOptions, defaultWastePercent } = await loadWallTypesScreen(company.id);
  // ── THE STARTERS ARE OFFERED WHILE ANY IS MISSING (#818) ──
  //
  // They used to be offered only on an EMPTY library, so a company whose first
  // type came off a partition schedule could never get W1 or ACT1 without
  // typing them. `missingStarterTypes` is the same rule `addStarterWallTypes`
  // writes by, so the count on the button is the count the press adds.
  const missingStarters = missingStarterTypes(views.map((type) => type.code)).map((type) => type.code);

  return (
    <PageShell width="working">
      <PageHeader
        route="/wall-types"
        subtitle="Your partition schedule: each wall type by its drawing tag, and what goes into a foot of it."
      />
      <p className="mb-6 max-w-3xl text-sm text-ink-body">
        On a job you enter each run of wall by its type, length and height, and the
        estimate&rsquo;s lines are worked out from these. Link a part to your price book to price it, and give it your
        crew&rsquo;s rate to get the hours.
      </p>

      {views.length === 0 ? (
        <div className="mb-6 flex flex-col gap-3">
          <EmptyState
            data-tour="wall-types-empty"
            title="No wall types yet"
            purpose={
              <p>
                A floor plan tells you how many feet of wall there are. It does not tell you what the wall is or how
                tall — the partition schedule and the sections do. Put your wall types here once and every job&rsquo;s
                runs turn into studs, track and board by themselves.
              </p>
            }
            actions={[{ label: "Open your price book", href: "/catalog" }]}
          />
        </div>
      ) : (
        <ul data-tour="wall-types-list" className="mb-6 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
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

      {/* OUTSIDE the empty/list branch, deliberately. Pressing it on an empty
          library swaps that branch from the empty state to the list, and a
          button rendered inside the branch would unmount with it — taking
          its "Added …" sentence along before anybody could read it. Here it
          stays mounted across the swap; with nothing left to add it renders
          only that sentence, and nothing at all once the page reloads. */}
      <StarterWallTypesButton missing={missingStarters} hasLibrary={views.length > 0} />

      {/* Behind its button (declutter, 2026-10-13: it rendered open). */}
      <div data-tour="wall-types-add">
        <CollapsedForm label="Add wall type">
          <NewWallTypeForm initial={thicknessFromTakeoff === null ? undefined : { thicknessIn: thicknessFromTakeoff.toFixed(2) }} />
        </CollapsedForm>
      </div>
    </PageShell>
  );
}
