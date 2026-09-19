/**
 * The documents C Stream generates for DocuSign, and the frozen snapshots
 * that record what they said. Pure: no database, no network.
 *
 * WHY HTML AND NOT A PDF. C Stream does not generate PDFs anywhere — the
 * built-in e-sign link renders the contract summary as a page, and signs
 * THAT, storing a JSON snapshot. DocuSign accepts .html as a document type
 * and converts it (developers.docusign.com / support "Supported file
 * formats": .htm, .html), so the same content goes to DocuSign as the page
 * the built-in link shows, and DocuSign returns a signed PDF on completion.
 * No PDF library was added to do a conversion DocuSign already does.
 *
 * THE SIGNATURE PLACE is an anchor: the text `/sn1/`, printed in white,
 * where the signature belongs. The envelope request puts a Sign Here tab on
 * that anchor (lib/docusign/envelope-request.ts). Anchor tabs on a converted
 * HTML document were NOT exercised against a live account from this branch
 * — it is the first thing the demo click-list checks.
 *
 * Every value from the database is escaped. A line item's description is
 * text a person typed and this page goes to a third party's renderer.
 */

export const SIGN_HERE_ANCHOR = "/sn1/";
export const DATE_SIGNED_ANCHOR = "/ds1/";

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Same shape as SignatureRequest.snapshot, so the two routes freeze the
 * same facts about the same contract. */
export type ContractSummarySnapshot = {
  companyName: string;
  jobName: string;
  clientName: string;
  scope: string | null;
  total: number;
  lineItems: { description: string; quantity: string; unit: string | null; unitPrice: string | null }[];
};

export function contractSummarySnapshot(job: {
  companyName: string;
  jobName: string;
  clientName: string;
  scope: string | null;
  lineItems: { description: string; quantity: { toString(): string } | number | string; unit: string | null; unitPrice: { toString(): string } | number | string | null }[];
}): ContractSummarySnapshot {
  const total = job.lineItems.reduce(
    (sum, item) => sum + Number(item.quantity.toString()) * Number(item.unitPrice?.toString() ?? 0),
    0,
  );
  return {
    companyName: job.companyName,
    jobName: job.jobName,
    clientName: job.clientName,
    scope: job.scope,
    total,
    lineItems: job.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice?.toString() ?? null,
    })),
  };
}

const STYLE = `body{font-family:Helvetica,Arial,sans-serif;color:#111;font-size:12px;margin:32px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #ccc;padding:6px 4px;text-align:left;vertical-align:top}
td.n,th.n{text-align:right}.muted{color:#555}.sig{margin-top:40px}.anchor{color:#ffffff}`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function signatureBlock(signerLabel: string): string {
  return `<div class="sig"><p>${escapeHtml(signerLabel)}</p>
<p>Signature: <span class="anchor">${SIGN_HERE_ANCHOR}</span></p>
<p>Date signed: <span class="anchor">${DATE_SIGNED_ANCHOR}</span></p></div>`;
}

export function contractSummaryHtml(snapshot: ContractSummarySnapshot): string {
  const rows = snapshot.lineItems
    .map((item) => {
      const qty = Number(item.quantity);
      const price = item.unitPrice === null ? null : Number(item.unitPrice);
      const amount = price === null ? "" : money(qty * price);
      return `<tr><td>${escapeHtml(item.description)}</td><td class="n">${escapeHtml(item.quantity)}${item.unit ? ` ${escapeHtml(item.unit)}` : ""}</td><td class="n">${price === null ? "" : money(price)}</td><td class="n">${amount}</td></tr>`;
    })
    .join("");
  return page(
    `${snapshot.jobName} — contract`,
    `<h1>${escapeHtml(snapshot.jobName)}</h1>
<p class="muted">Contract from ${escapeHtml(snapshot.companyName)} to ${escapeHtml(snapshot.clientName)}</p>
${snapshot.scope ? `<h2>Scope</h2><p>${escapeHtml(snapshot.scope)}</p>` : ""}
<h2>Pricing</h2>
<table><thead><tr><th>Item</th><th class="n">Quantity</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead>
<tbody>${rows}</tbody></table>
<p class="n"><strong>Total: ${money(snapshot.total)}</strong></p>
${signatureBlock(`Agreed for ${snapshot.clientName}:`)}`,
  );
}

export type ChangeOrderSnapshot = {
  companyName: string;
  jobName: string;
  clientName: string;
  number: number;
  title: string;
  description: string | null;
  submittedOn: string | null;
  /** Formatted contract-value delta, as the job page shows it. */
  valueDelta: string;
  proposals: string[];
};

export function changeOrderHtml(snapshot: ChangeOrderSnapshot): string {
  const items = snapshot.proposals.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  return page(
    `Change order #${snapshot.number}`,
    `<h1>Change order #${snapshot.number}: ${escapeHtml(snapshot.title)}</h1>
<p class="muted">${escapeHtml(snapshot.jobName)} — from ${escapeHtml(snapshot.companyName)} to ${escapeHtml(snapshot.clientName)}${
      snapshot.submittedOn ? ` — submitted ${escapeHtml(snapshot.submittedOn)}` : ""
    }</p>
${snapshot.description ? `<p>${escapeHtml(snapshot.description)}</p>` : ""}
${items ? `<h2>Changes</h2><ul>${items}</ul>` : ""}
<p><strong>Change to contract value: ${escapeHtml(snapshot.valueDelta)}</strong></p>
${signatureBlock(`Approved for ${snapshot.clientName}:`)}`,
  );
}

/** One change-order proposal as a line on the document — the same wording
 * the job page's change-order log uses for it. */
export function describeChangeOrderProposal(
  proposal: {
    changeType: string;
    description: string | null;
    quantity: { toString(): string } | number | string | null;
    unit: string | null;
    unitPrice: { toString(): string } | number | string | null;
  },
  target: { description: string } | null,
): string {
  if (proposal.changeType === "ADD") {
    const price = proposal.unitPrice !== null && proposal.unitPrice !== undefined ? ` @ ${money(Number(proposal.unitPrice.toString()))}` : "";
    return `Add: ${proposal.description ?? "New scope"} — ${proposal.quantity?.toString() ?? 1}${proposal.unit ? ` ${proposal.unit}` : ""}${price}`;
  }
  if (proposal.changeType === "REMOVE") {
    return `Remove: ${target?.description ?? "(line item)"}`;
  }
  const parts: string[] = [];
  if (proposal.quantity !== null && proposal.quantity !== undefined) parts.push(`quantity to ${proposal.quantity.toString()}`);
  if (proposal.unitPrice !== null && proposal.unitPrice !== undefined) parts.push(`price to ${money(Number(proposal.unitPrice.toString()))}`);
  return `Change: ${target?.description ?? "(line item)"} — ${parts.join(", ")}`;
}

/** Base64 of a UTF-8 string, for `documentBase64`. */
export function base64Utf8(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}
