"use server";

import { requireCompanyContext } from "@/lib/auth";
import { askAboutCompany, type AskResult } from "@/lib/ask/answer";

/** Asking a question about this company's own data.
 *
 * Returns its failures rather than throwing them, like every action here:
 * a production build redacts a thrown Server Action message to an opaque
 * digest, and "the assistant is unavailable" is exactly the sentence a
 * user has to be able to read.
 *
 * Read-only. Nothing in the tool layer writes, so there is no double-submit
 * hazard and no revalidatePath — asking the same question twice costs an
 * API call and changes nothing.
 */
export async function askQuestion(question: string): Promise<AskResult> {
  // The company comes from the session here and is passed down as an
  // argument. It is not part of any tool schema, so the model has no way
  // to express a request for anyone else's rows.
  const { company } = await requireCompanyContext();
  return askAboutCompany(company.id, question);
}
