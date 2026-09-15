import type {
  CreateFieldReportInput,
  FieldReportRow,
  Job,
  Media,
  SafetyIncident,
  ToolboxTalk,
  UpdateFieldReportInput,
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
  input: { topic: string; heldOn: string; presenter?: string; attendees?: string; notes?: string },
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
  },
  token: string,
): Promise<SafetyIncident> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/incidents`, {
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
