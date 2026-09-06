import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { ContractSummary } from "@/components/ContractSummary";
import { EsignForm } from "@/components/EsignForm";
import { SIGNING_LINK_MESSAGES, signingLinkState } from "@/lib/link-access";

type Snapshot = {
  companyName: string;
  jobName: string;
  clientName: string;
  scope: string | null;
  total: number;
  lineItems: { description: string; quantity: string; unit: string | null; unitPrice: string | null }[];
};

/**
 * A link that no longer opens, said in words rather than as a 404.
 *
 * The person reading this was handed the URL by a contractor and has done
 * nothing wrong. A blank "not found" reads as "you were sent a broken
 * link"; this reads as "ask for a new one". The 404 is kept for a token
 * that never existed at all, where saying anything more would confirm to
 * someone trying tokens which guesses landed on a real contract.
 */
function LinkUnavailable({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-5">
        <h1 className="text-lg font-semibold text-amber-100">This signing link is no longer live</h1>
        <p className="mt-2 text-sm text-amber-100/90">{message}</p>
      </div>
    </main>
  );
}

export default async function EsignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const request = await prisma.signatureRequest.findUnique({
    where: { token },
    include: {
      job: {
        include: {
          company: true,
          contact: true,
          lineItems: {
            where: { isDeleted: false },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!request) {
    notFound();
  }

  // Whether this bearer link is still allowed to sign anything — see
  // lib/link-access.ts. `signRequest` re-checks the identical thing at the
  // moment of the write, so a form left open in a tab cannot outlive the
  // gate this page rendered with.
  const linkState = signingLinkState(request, request.job, new Date());

  if (linkState.state === "SIGNED") {
    const snapshot = request.snapshot as unknown as Snapshot;
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-6 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-300">
          Signed by {request.signerName} on{" "}
          {/* UTC, EXPLICITLY. Without a timeZone this rendered the SERVER's
              calendar day, which on Vercel is UTC — so a contract signed at
              6pm in California was dated tomorrow, on the single date a
              dispute over this document would turn on. Every other date in
              this app is stored and rendered at UTC (CLAUDE.md), so the fix
              is to say so rather than to guess at the signer's zone: the
              zone is named on screen, which is what makes the date
              checkable against the timestamp rather than merely plausible. */}
          {request.signedAt?.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })}{" "}
          (UTC). This reflects exactly what was agreed to at the time of signing.
        </div>
        <ContractSummary
          companyName={snapshot.companyName}
          jobName={snapshot.jobName}
          // The client signing does not contract the job -- markJobContracted
          // is still a separate, deliberate step by the contractor. Showing
          // "Contracted" here claimed something that hadn't happened, and
          // disagreed with the job page, which still read "Estimate".
          status="SIGNED"
          clientName={snapshot.clientName}
          scope={snapshot.scope}
          // This is the frozen snapshot, so the footnote must not call it
          // "current" — it sat forty lines under the banner above saying the
          // opposite. See ContractSummaryBasis.
          basis="signed"
          lineItems={snapshot.lineItems.map((item, i) => ({
            id: String(i),
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            changeOrderNumber: null,
          }))}
        />
      </main>
    );
  }

  if (linkState.state === "EXPIRED" || linkState.state === "JOB_NOT_ESTIMATE") {
    return <LinkUnavailable message={SIGNING_LINK_MESSAGES[linkState.state]} />;
  }

  const { job } = request;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <ContractSummary
        companyName={job.company.name}
        jobName={job.name}
        status={job.status}
        clientName={job.contact.name}
        scope={job.scope}
        lineItems={job.lineItems.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity.toString(),
          unit: item.unit,
          unitPrice: item.unitPrice?.toString() ?? null,
          changeOrderNumber: null,
        }))}
      />

      <EsignForm
        token={token}
        defaultName={job.contact.name}
        defaultEmail={job.contact.email ?? ""}
      />
    </main>
  );
}
