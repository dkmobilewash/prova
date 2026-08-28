// Every action module, re-exported so `@/lib/actions` keeps working exactly
// as it did when this was one 2,200-line file. No call site changed.
//
// This barrel is deliberately NOT a "use server" module. Next.js rejects
// `export *` inside one — it can't statically prove a wildcard only yields
// async functions. It doesn't need to be: each domain file below carries its
// own "use server", and a re-exported server action keeps that identity from
// where it's defined.
//
// shared.ts is not re-exported here — it holds constants and sync helpers,
// which domain files import directly.

export * from "./jobs";
export * from "./estimating";
export * from "./billing";
export * from "./labor";
export * from "./compliance";
export * from "./company";
export * from "./vendors";
export * from "./equipment";
export * from "./punchLists";
export * from "./fieldReports";
export * from "./safety";
export * from "./rfis";
export * from "./changeOrders";
