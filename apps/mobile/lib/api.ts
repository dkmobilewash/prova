import type {
  CreateFieldReportInput,
  FieldReportRow,
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
