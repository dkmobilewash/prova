/**
 * Grouping child rows under their parent, for loaders that fetch a
 * relation as its own flat query instead of nesting it.
 *
 * WHY THE LOADERS DO THAT. Prisma (this repo does not enable the
 * `relationJoins` preview feature) resolves a nested `select` as one extra
 * query PER RELATION, and it runs sibling relations ONE AFTER ANOTHER. The
 * alert engine's job read had nine relations under `Job`, so it was ten
 * database round trips back to back — about a second of the (app) layout's
 * render on every page and after every Server Action (measured
 * 2026-09-18; see changelog.d/cyrus-fast-lists.md).
 *
 * The flat form issues THE SAME child queries — `WHERE "jobId" IN (...)`,
 * the same ORDER BY where the nested form had one — but all at once, so
 * the wait is two round trips instead of ten. Because the SQL for each
 * child is the one Prisma already sent, the rows arrive in the same order
 * they always did; these helpers keep that order within each group.
 */

/** Every row under its key, in the order the rows were given. A key with
 * no rows is simply absent — read it with `rowsFor`. */
export function groupRowsBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** The rows under `key`, or an empty list — which is what a nested
 * relation with no children returns, never `undefined`. */
export function rowsFor<T, K>(groups: Map<K, T[]>, key: K): T[] {
  return groups.get(key) ?? [];
}

/** The FIRST row per key, in the order given — the flat form of a nested
 * `orderBy: …, take: 1`. Prisma itself implements that nested `take` by
 * reading every child in the requested order and keeping the first per
 * parent, so this reproduces it exactly when handed the same ordered rows. */
export function firstRowBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T> {
  const firsts = new Map<K, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!firsts.has(key)) firsts.set(key, row);
  }
  return firsts;
}
