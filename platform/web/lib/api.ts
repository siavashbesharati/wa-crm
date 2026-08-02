const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export type Session = {
  access_token: string;
  refresh_token: string;
  user_id: string;
  org_id: string;
  role: string;
};

function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("wa_crm_session");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem("wa_crm_session", JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem("wa_crm_session");
}

export function getSession() {
  return loadSession();
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (options.auth !== false) {
    const session = loadSession();
    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`);
      headers.set("X-Org-Id", session.org_id);
    }
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.message || "خطای سرور");
  }
  return data as T;
}
