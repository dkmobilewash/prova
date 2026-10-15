import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { unsubscribeByToken } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { leadIdFromToken } from "@/lib/outbound-token";

/**
 * THE OPT-OUT EVERY COLD EMAIL LINKS TO. Public, no Clerk (see middleware.ts):
 * one question, one button, nothing to type.
 *
 * What it shows is DERIVED from the lead, never from a query string: a lead
 * already marked do-not-contact — by this link, a reply, a call — reads
 * "Done", so a refresh, a second click or an old tab all tell the truth.
 *
 * A bad token is a plain sentence, not a 404 and never a 500, and it names
 * nothing — a link that does not verify must not reveal whose it might be.
 */

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const leadId = leadIdFromToken(token);
  const lead = leadId
    ? await prisma.salesLead.findUnique({ where: { id: leadId }, select: { companyName: true, doNotContact: true } })
    : null;

  return (
    <PageShell width="reading">
      <div className="rounded-lg border border-line-card bg-surface p-6">
        {!lead ? (
          <>
            <h1 className="text-lg font-semibold text-ink">This link isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-ink-body">
              It may have been copied incompletely. If you want us to stop emailing you, reply to
              any of our emails with &ldquo;stop&rdquo; and we will.
            </p>
          </>
        ) : lead.doNotContact ? (
          <>
            <h1 className="text-lg font-semibold text-ink">Done — you won&apos;t hear from us again.</h1>
            <p className="mt-2 text-sm text-ink-body">
              {lead.companyName} is off our email list. You don&apos;t need to do anything else.
            </p>
          </>
        ) : (
          <form action={unsubscribeByToken.bind(null, token)}>
            <h1 className="text-lg font-semibold text-ink">Stop emails to {lead.companyName}?</h1>
            <p className="mt-2 text-sm text-ink-body">
              One click and C Stream stops emailing {lead.companyName}. Nothing else to fill in.
            </p>
            <SubmitButton
              type="submit"
              className="mt-4 inline-flex w-fit items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
            >
              Confirm — stop emails
            </SubmitButton>
          </form>
        )}
      </div>
    </PageShell>
  );
}
