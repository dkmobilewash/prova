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
  /** Filled in by the server from the job's site address; absent on a row
   * the phone just queued. */
  weatherLine?: string | null;
  weatherKind?: "forecast" | "observed" | null;
  /** The day's crew from its time entries. */
  manpowerLine?: string | null;
  /** Set when the day is signed (so the report is locked). */
  lockState?: "SUBMITTED" | "APPROVED" | null;
};

/** One logged delay, as GET /api/v1/jobs/[id]/delays returns it. */
export type DelayRow = {
  id: string;
  date: string;
  cause: string;
  causeLabel: string;
  responsibleParty: string;
  responsibleLabel: string;
  responsibleName: string | null;
  start: string | null;
  end: string | null;
  workersAffected: number | null;
  hoursLost: string | null;
  description: string;
  gcNotifiedHow: string | null;
  gcNotifiedWho: string | null;
  gcNotifiedAt: string | null;
  changeOrderId: string | null;
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
  /** What it was taken for, when the person said so at the shutter. */
  dailyFieldReportId?: string | null;
  punchListItemId?: string | null;
  tags?: { id: string; name: string }[];
};

/** One of the company's photo tags, offered at the shutter. */
export type MediaTag = { id: string; name: string };

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
  /** Set only on clocked entries; null on typed ones. */
  clockStartedAt: string | null;
  clockEndedAt: string | null;
  clockBreakMinutes: number | null;
  employeeName: string;
  lineItemDescription: string | null;
  craftLabel: string | null;
  crewMemberId?: string | null;
  lineItemId?: string | null;
  craftClassificationId?: string | null;
  /** The entry is the signed-in user's own (only on the list endpoint). */
  mine?: boolean;
};

export type CrewMember = {
  id: string;
  name: string;
};

export type LineItem = {
  id: string;
  description: string;
};

export type Craft = {
  id: string;
  name: string;
  tier: "JOURNEYMAN" | "APPRENTICE" | "FOREMAN" | null;
  /** The signed-in user works under this craft. */
  mine: boolean;
  /** Crew members who work under this craft. */
  crewMemberIds: string[];
};

export type RatioWarning = {
  /** "planned" = today's crew schedule, counted in people; "logged" = hours. */
  source: "planned" | "logged";
  unionLocalLabel: string;
  rule: string;
  status: "OVER" | "NO_JOURNEYMAN";
  journeymen: number;
  apprentices: number;
  allowedApprentices: number | null;
};

export type TmTicket = {
  id: string;
  workDate: string;
  workDescription: string;
  snapshot: {
    labor: {
      workerName: string;
      hours: string;
      payType: string;
      craftLabel: string | null;
      lineItemDescription: string | null;
    }[];
    materials: {
      description: string;
      vendorName: string;
      orderedOn: string;
    }[];
  } | null;
  signerName: string;
  signedAt: string;
  /** False on tickets signed before the phone took drawn signatures. */
  hasSignature?: boolean;
};

/** A day's hours signed by the foreman. While one exists for a day, that
 * day's hours are locked; the office approves it or reopens it. */
export type TimesheetSignoff = {
  id: string;
  date: string;
  state: "SUBMITTED" | "APPROVED";
  signerName: string;
  signedAt: string;
  entryCount: number;
  totalHours: string;
  approvedAt: string | null;
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

export type PunchItemStatus = "OPEN" | "READY_FOR_REVIEW" | "VERIFIED";

export type PunchListItem = {
  id: string;
  description: string;
  /** Three states, not two. The middle one — we say it is fixed, nobody
   * has checked yet — is the one a foreman needs to see, and a tick box
   * cannot show it. `isDone` and `completedAt` were dropped from the
   * server's row and from this type together. */
  status: PunchItemStatus;
  area: string | null;
  dueOn: string | null;
  assignedName: string | null;
  /** Photos attached to this item. Zero is what the "add a photo of the
   * fix" prompt is asking about. */
  photoCount: number;
};

export type DrawingRevisionRow = {
  id: string;
  label: string;
  issuedOn: string;
  receivedOn: string | null;
  description: string | null;
  fileUrl: string | null;
  fileName: string | null;
};

export type DrawingSetRow = {
  id: string;
  name: string;
  description: string | null;
  revisions: DrawingRevisionRow[];
  /** The revision that governs — latest ISSUED, received or not. */
  currentRevisionId: string | null;
  /** …and it has not reached site. The state worth carrying on a phone:
   * the crew is building from the one before it. */
  currentNotReceived: boolean;
  latestReceivedRevisionId: string | null;
};

export type ScheduleRow = {
  id: string;
  workDate: string;
  workerName: string;
  workerKind: "user" | "crew";
  workerId: string;
  craftLabel: string | null;
  /** Null for a day that has not happened yet — where `false` would read
   * as an accusation rather than a fact. */
  hoursLogged: boolean | null;
};

/** The capabilities the SERVER derives (apps/web/lib/permissions.ts) and
 * hands to the phone. Deliberately a plain string list rather than a rule
 * set: the phone must not carry a second copy of who-can-do-what, because
 * a copy inside an app-store binary goes stale the day a job function
 * changes and cannot be fixed without a release. */
export type Capability =
  | "VIEW_JOB_COSTS"
  | "VIEW_COMPANY_FINANCIALS"
  | "MANAGE_ESTIMATING"
  | "MANAGE_BILLING"
  | "MANAGE_COMPLIANCE"
  | "MANAGE_FIELD"
  | "MANAGE_JOBS"
  | "VERIFY_PUNCH_ITEMS";

export type Me = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  jobFunction: string | null;
  capabilities: Capability[];
  /** Narrower than a plain member — the phone says WHY a screen is
   * missing rather than quietly drawing a smaller app. */
  restricted: boolean;
  company: { id: string; name: string };
};

/** One alert, already filtered to what this principal may see and already
 * money-stripped server-side. `amount` rides along null — the phone
 * renders no money, and it must never be a second place deciding the
 * rule. */
export type AlertRow = {
  key: string;
  kind: string;
  severity: "OVERDUE" | "DUE_SOON" | "STANDING";
  title: string;
  detail: string;
  href: string;
  dueOn: string | null;
  daysUntil: number | null;
  amount: number | null;
};
