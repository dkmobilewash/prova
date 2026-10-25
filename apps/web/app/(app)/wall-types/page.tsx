import { PageHeader } from "@/components/PageHeader";
import { CollapsedForm } from "@/components/CollapsedForm";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { EmptyState } from "@/components/EmptyState";
import { NewWallTypeForm, StarterWallTypesButton, WallTypeCard } from "@/components/WallTypes";
import { loadWallTypesScreen } from "@/lib/wall-types-view";

/**
 * The company's partition schedule — every wall type it builds, and what each
 * one is made of. A job's wall runs are priced from these; editing one here
 * changes an existing estimate only when that job's schedule is refreshed.
 */
export default async function WallTypesPage() {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;

  // Shared with C Stream Bid's /bid/wall-types — see lib/wall-types-view.ts.
  const { views, catalogOptions, craftOptions, defaultWastePercent } = await loadWallTypesScreen(company.id);

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
          <StarterWallTypesButton />
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

      {/* Behind its button (declutter, 2026-10-13: it rendered open). */}
      <div data-tour="wall-types-add">
        <CollapsedForm label="Add wall type">
          <NewWallTypeForm />
        </CollapsedForm>
      </div>
    </PageShell>
  );
}
