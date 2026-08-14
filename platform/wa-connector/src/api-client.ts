import { config } from "./config.js";

export type WaSessionInfo = {
  id: string;
  org_id: string;
  label: string;
  external_id: string;
  wa_jid: string;
  pairing_state: string;
  status: string;
};

export type AuthState = {
  account_id: string;
  creds_json: string;
  keys_json: string;
};

export type ClaimedJob = {
  id: string;
  account_id: string;
  lead_id: string | null;
  target_name: string;
  target_jid: string;
  body: string;
  sender_type: string;
  status: string;
  trace_id?: string;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Connector-Key": config.connectorKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listSessions: () => request<WaSessionInfo[]>("GET", "/internal/wa/sessions"),
  getAuth: (accountId: string) =>
    request<AuthState>("GET", `/internal/wa/sessions/${accountId}/auth`),
  putAuth: (accountId: string, creds_json: string, keys_json: string) =>
    request<AuthState>("PUT", `/internal/wa/sessions/${accountId}/auth`, {
      creds_json,
      keys_json,
    }),
  clearAuth: (accountId: string) =>
    request<{ ok: boolean }>("DELETE", `/internal/wa/sessions/${accountId}/auth`),
  putPairState: (
    accountId: string,
    payload: {
      pairing_state: string;
      qr_payload?: string;
      wa_jid?: string;
      status?: string;
      external_id?: string;
    }
  ) => request("PUT", `/internal/wa/sessions/${accountId}/pair-state`, payload),
  heartbeat: (accountId: string) =>
    request<{ ok: boolean }>("POST", `/internal/wa/sessions/${accountId}/heartbeat`),
  ingest: (accountId: string, body: Record<string, unknown>) =>
    request("POST", `/internal/wa/sessions/${accountId}/ingest`, body),
  claimJobs: (accountId: string, limit = 5) =>
    request<{ jobs: ClaimedJob[] }>(
      "POST",
      `/internal/wa/jobs/claim?account_id=${encodeURIComponent(accountId)}&limit=${limit}`
    ),
  completeJob: (jobId: string, ok: boolean, error = "") =>
    request(
      "POST",
      `/internal/wa/jobs/${jobId}/complete?ok=${ok ? "true" : "false"}&error=${encodeURIComponent(error)}`
    ),
  getPairCommand: (accountId: string) =>
    request<{ account_id: string; pairing_state: string; status: string; wa_jid: string }>(
      "GET",
      `/internal/wa/sessions/${accountId}/pair-command`
    ),
};
