const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export type Session = {
  access_token: string;
  refresh_token: string;
  user_id: string;
  org_id: string;
  role: string;
};

export type PlatformSession = {
  access_token: string;
  refresh_token: string;
  user_id: string;
  role: string;
  scope: "platform";
};

const ORG_KEY = "wa_crm_session";
const PLATFORM_KEY = "wa_platform_session";

function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(ORG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function loadPlatformSession(): PlatformSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(PLATFORM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlatformSession;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(ORG_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(ORG_KEY);
}

export function getSession() {
  return loadSession();
}

export function savePlatformSession(session: PlatformSession) {
  localStorage.setItem(PLATFORM_KEY, JSON.stringify(session));
}

export function clearPlatformSession() {
  localStorage.removeItem(PLATFORM_KEY);
}

export function getPlatformSession() {
  return loadPlatformSession();
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { auth?: boolean; platform?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (options.auth !== false) {
    if (options.platform) {
      const session = loadPlatformSession();
      if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
    } else {
      const session = loadSession();
      if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
        headers.set("X-Org-Id", session.org_id);
      }
    }
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail || data.message || "خطای سرور";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}
