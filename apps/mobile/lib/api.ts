import type {
  CreateFieldReportInput,
  Craft,
  CrewMember,
  FieldReportRow,
  Job,
  LineItem,
  MaterialOrder,
  Media,
  PunchListItem,
  SafetyIncident,
  TimeEntry,
  TmTicket,
  ToolboxTalk,
  UpdateFieldReportInput,
  Vendor,
} from "./types";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

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

export async function listPunchListItems(jobId: string, token: string): Promise<PunchListItem[]> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/punch-list`, { token });
}

export async function createPunchListItem(
  jobId: string,
  input: { description: string; clientOperationId?: string },
  token: string,
): Promise<PunchListItem> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/punch-list`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function setPunchListItemDone(
  jobId: string,
  itemId: string,
  isDone: boolean,
  token: string,
): Promise<PunchListItem> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/punch-list/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    token,
    body: { isDone },
  });
}
