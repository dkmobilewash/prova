// The field-reports API contract, redeclared here because it lives in
// apps/web/lib/field-reports-core.ts (inside the Next app), not in a shared
// package a mobile app can import. Keep these in sync with the route JSON:
// reportDate is "YYYY-MM-DD", the timestamps are ISO strings over the wire.

export type FieldReportRow = {
  id: string;
  jobId: string;
  reportDate: string;
  crewPresent: string | null;
  workPerformed: string;
  weather: string | null;
  delays: string | null;
  filedByUserId: string | null;
  clientId: string | null;
  clientUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FieldReportFields = {
  workPerformed: string;
  crewPresent: string | null;
  weather: string | null;
  delays: string | null;
};

export type CreateFieldReportInput = {
  jobId: string;
  reportDate: string;
  workPerformed: string;
  crewPresent?: string | null;
  weather?: string | null;
  delays?: string | null;
  clientId?: string | null;
  clientOperationId?: string | null;
  clientUpdatedAt?: string | null;
};

export type UpdateFieldReportInput = {
  workPerformed?: string;
  crewPresent?: string | null;
  weather?: string | null;
  delays?: string | null;
  clientId?: string | null;
  clientUpdatedAt?: string | null;
};

export type Job = {
  id: string;
  name: string;
  status: "ESTIMATE" | "CONTRACTED" | "IN_PROGRESS" | "COMPLETE";
  startDate: string | null;
  endDate: string | null;
};
