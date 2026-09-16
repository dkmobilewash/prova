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

export type Media = {
  id: string;
  blobUrl: string;
  contentType: string;
  byteSize: number;
  caption: string | null;
  capturedAt: string;
  capturedLatitude: number | null;
  capturedLongitude: number | null;
  capturedAccuracyMeters: number | null;
};

export type ToolboxTalk = {
  id: string;
  jobId: string | null;
  heldOn: string;
  topic: string;
  presenter: string | null;
  attendees: string | null;
  notes: string | null;
};

export type IncidentClassification =
  | "INJURY"
  | "SKIN_DISORDER"
  | "RESPIRATORY_CONDITION"
  | "POISONING"
  | "HEARING_LOSS"
  | "OTHER_ILLNESS";

export type IncidentOutcome =
  | "DEATH"
  | "DAYS_AWAY"
  | "RESTRICTED_OR_TRANSFER"
  | "OTHER_RECORDABLE"
  | "FIRST_AID_ONLY";

export type SafetyIncident = {
  id: string;
  caseNumber: number;
  caseYear: number;
  occurredAt: string;
  employeeName: string;
  jobTitle: string | null;
  location: string | null;
  description: string;
  classification: IncidentClassification;
  outcome: IncidentOutcome;
  daysAway: number | null;
  daysRestricted: number | null;
};

export type TimeEntryPayType = "STRAIGHT" | "OVERTIME" | "DOUBLE_TIME" | "SHIFT_DIFFERENTIAL";

export type TimeEntry = {
  id: string;
  date: string;
  hours: string;
  payType: TimeEntryPayType;
  note: string | null;
  employeeName: string;
};

export type Vendor = {
  id: string;
  name: string;
};

export type MaterialOrder = {
  id: string;
  number: number;
  description: string;
  vendorReference: string | null;
  notes: string | null;
  orderedOn: string;
  promisedFor: string | null;
  vendorName: string;
};

export type PunchListItem = {
  id: string;
  description: string;
  isDone: boolean;
  completedAt: string | null;
};
