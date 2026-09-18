import { prisma } from "@prova/db";

import { parsePageContext } from "./page-context";

/**
 * Resolve the page the person is on into a job they are actually allowed
 * to see — or nothing.
 *
 * THIS FUNCTION IS THE SECURITY BOUNDARY for the page hint, and it is one
 * `where` clause wide on purpose. `page-context.ts` parses a browser-supplied
 * path and cannot know whose job it names; this is where that is decided.
 *
 * `companyId` is a PARAMETER, closed over from the Clerk session by the
 * caller and never taken from the request body — the same arrangement the
 * tools use and for the same reason. So a forged `/jobs/<someone-else's-id>`
 * finds no row and returns null, which is byte-identical to sending no path
 * at all. There is deliberately no branch that reports "that job is not
 * yours": telling a caller their guess named a real job elsewhere is an
 * existence oracle, and silence costs nothing here because the honest
 * outcome is the same either way — the assistant simply has no default.
 *
 * `findFirst` rather than `findUnique`: the id alone is unique, but the
 * predicate that matters is id AND company, and writing it as one where
 * clause keeps the scope impossible to drop in a later edit. A
 * `findUnique({ id })` followed by a check is the same thing with one more
 * place to forget.
 */
export async function resolvePageJob(
  companyId: string,
  pagePath: string | undefined,
): Promise<{ id: string; name: string } | null> {
  const hint = parsePageContext(pagePath);
  if (!hint) return null;

  return prisma.job.findFirst({
    where: { id: hint.id, companyId },
    select: { id: true, name: true },
  });
}
