import { localToday } from "./local-today";
import type {
  AlertRow,
  CreateFieldReportInput,
  Craft,
  CrewMember,
  DelayRow,
  FieldReportRow,
  Job,
  LineItem,
  MaterialOrder,
  Me,
  Media,
  MediaTag,
  DrawingSetRow,
  PunchListItem,
  ScheduleRow,
  RatioWarning,
  SafetyIncident,
  TimeEntry,
  TimesheetSignoff,
  TmTicket,
  ToolboxTalk,
  UpdateFieldReportInput,
  Vendor,
} from "./types";

import { apiBaseUrl } from "./env";

const BASE_URL = apiBaseUrl;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: { method?: string; token: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

/** Who is holding this phone and what they may do — derived on the
 * server, never re-derived here. See app/api/v1/me. */
export async function getMe(token: string): Promise<Me> {
  return request(`/api/v1/me`, { token });
}

export async function listFieldReports(jobId: string, token: string): Promise<FieldReportRow[]> {
  return request(`/api/v1/field-reports?jobId=${encodeURIComponent(jobId)}`, { token });
}

export async function createFieldReport(input: CreateFieldReportInput, token: string): Promise<FieldReportRow> {
  return request(`/api/v1/field-reports`, { method: "POST", token, body: input });
}

export async function updateFieldReport(
  id: string,
  input: UpdateFieldReportInput,
  token: string,
): Promise<{ applied: boolean; report: FieldReportRow }> {
  return request(`/api/v1/field-reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export async function listJobs(token: string): Promise<Job[]> {
  return request(`/api/v1/jobs`, { token });
}

/** The company alert list — the phone sends its own calendar day, the
 * same convention as the schedule reads. */
export async function listAlerts(token: string): Promise<AlertRow[]> {
  return request(`/api/v1/alerts?today=${localToday()}`, { token });
}

export async function listToolboxTalks(jobId: string, token: string): Promise<ToolboxTalk[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/toolbox-talks`, { token });
}

export async function createToolboxTalk(
  jobId: string,
  input: { topic: string; heldOn: string; presenter?: string; attendees?: string; notes?: string; clientOperationId?: string },
  token: string,
): Promise<ToolboxTalk> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/toolbox-talks`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function listIncidents(jobId: string, token: string): Promise<SafetyIncident[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/incidents`, { token });
}

export async function createIncident(
  jobId: string,
  input: {
    employeeName: string;
    description: string;
    occurredAt: string;
    classification: string;
    outcome: string;
    clientOperationId?: string;
  },
  token: string,
): Promise<SafetyIncident> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/incidents`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function listTimeEntries(jobId: string, token: string): Promise<TimeEntry[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/time-entries`, { token });
}

export async function createTimeEntry(
  jobId: string,
  input: {
    date: string;
    hours: string;
    payType: string;
    note?: string;
    clientOperationId?: string;
    crewMemberId?: string;
    lineItemId?: string;
    craftClassificationId?: string;
    clockStartedAt?: string;
    clockEndedAt?: string;
    clockBreakMinutes?: number;
  },
  token: string,
): Promise<TimeEntry> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/time-entries`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function listCrew(token: string): Promise<CrewMember[]> {
  return request(`/api/v1/crew`, { token });
}

export async function listLineItems(jobId: string, token: string): Promise<LineItem[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/line-items`, { token });
}

export async function listCrafts(token: string): Promise<Craft[]> {
  return request(`/api/v1/crafts`, { token });
}

/** Apprentice-ratio breaches for one job on one day (the phone's own
 * yyyy-mm-dd), from the crew schedule and the hours already logged. */
export async function getApprenticeRatio(
  jobId: string,
  date: string,
  token: string,
): Promise<{ date: string; warnings: RatioWarning[] }> {
  return request(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/apprentice-ratio?date=${encodeURIComponent(date)}`,
    { token },
  );
}

export async function registerDeviceToken(
  input: { expoToken: string; platform: string },
  token: string,
): Promise<{ ok: boolean }> {
  return request(`/api/v1/device-tokens`, { method: "POST", token, body: input });
}

export async function listTmTickets(jobId: string, token: string): Promise<TmTicket[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/tickets`, { token });
}

export async function createTmTicket(
  jobId: string,
  input: {
    workDate: string;
    workDescription: string;
    signerName: string;
    signaturePath?: string;
    clientOperationId?: string;
  },
  token: string,
): Promise<TmTicket> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/tickets`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function listSignoffs(jobId: string, token: string): Promise<TimesheetSignoff[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/signoffs`, { token });
}

export async function createSignoff(
  jobId: string,
  input: { date: string; signerName: string; signaturePath: string; clientOperationId?: string },
  token: string,
): Promise<TimesheetSignoff> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/signoffs`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function listDelays(jobId: string, token: string): Promise<DelayRow[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/delays`, { token });
}

export type CreateDelayInput = {
  date: string;
  cause: string;
  responsibleParty: string;
  responsibleName?: string;
  startTime?: string;
  endTime?: string;
  workersAffected?: string;
  hoursLost?: string;
  description: string;
  gcNotifiedHow?: string;
  gcNotifiedWho?: string;
  gcNotifiedAt?: string;
  clientOperationId?: string;
};

export async function createDelay(jobId: string, input: CreateDelayInput, token: string): Promise<DelayRow> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/delays`, { method: "POST", token, body: input });
}

export async function listVendors(token: string): Promise<Vendor[]> {
  return request(`/api/v1/vendors`, { token });
}

export async function listMaterialOrders(jobId: string, token: string): Promise<MaterialOrder[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/material-orders`, { token });
}

export async function createMaterialOrder(
  jobId: string,
  input: {
    description: string;
    orderedOn: string;
    promisedFor?: string;
    vendorId: string;
    vendorReference?: string;
    notes?: string;
    clientOperationId?: string;
  },
  token: string,
): Promise<MaterialOrder> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/material-orders`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function listMedia(jobId: string, token: string): Promise<Media[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/media`, { token });
}

/** Where a photo is posted. The phone's queue uploads through the file
 * system's native multipart task (lib/photo-store.ts), which needs the URL
 * rather than a fetch call. */
export function mediaUploadUrl(jobId: string): string {
  return `${BASE_URL}/api/v1/jobs/${encodeURIComponent(jobId)}/media`;
}

/** Uploads a file as multipart form data. The `request` helper sends JSON,
 * so this is a separate path — the body is a FormData, and fetch sets the
 * multipart Content-Type (with boundary) itself. */
export async function uploadMedia(jobId: string, formData: FormData, token: string): Promise<Media> {
  const res = await fetch(`${BASE_URL}/api/v1/jobs/${encodeURIComponent(jobId)}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Upload failed (${res.status})`, res.status);
  }
  return data as Media;
}

export async function listMediaTags(token: string): Promise<MediaTag[]> {
  return request(`/api/v1/media-tags`, { token });
}

export async function listPunchListItems(jobId: string, token: string): Promise<PunchListItem[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/punch-list`, { token });
}

export async function createPunchListItem(
  jobId: string,
  input: { description: string; area?: string; clientOperationId?: string },
  token: string,
): Promise<PunchListItem> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/punch-list`, {
    method: "POST",
    token,
    body: input,
  });
}

/**
 * Moving an item between OPEN and READY_FOR_REVIEW.
 *
 * VERIFIED is not reachable from the phone on purpose — see the route's own
 * comment. Whoever fixed it says it is ready; somebody else agrees.
 */
export async function setPunchListItemStatus(
  jobId: string,
  itemId: string,
  status: "OPEN" | "READY_FOR_REVIEW",
  token: string,
): Promise<PunchListItem> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/punch-list/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    token,
    body: { status },
  });
}

export async function listDrawings(jobId: string, token: string): Promise<DrawingSetRow[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/drawings`, { token });
}

/** The schedule for a window of days. Omitting the dates gets the
 * server's default: a week either side of today, which is what a phone
 * wants — the plan ahead and the gaps behind.
 *
 * `today` is the PHONE'S calendar date, always sent. Whether a planned
 * day is past decides whether "no hours logged" is a fact or an
 * accusation, and UTC answers that wrong for every timezone west of it
 * after late afternoon. */
export async function listSchedule(
  jobId: string,
  token: string,
  window?: { from: string; to: string },
): Promise<ScheduleRow[]> {
  const parts = [`today=${localToday()}`];
  if (window) parts.push(`from=${window.from}`, `to=${window.to}`);
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/schedule?${parts.join("&")}`, { token });
}
