import { clearOrgMeCache, clearPlatformMeCache } from "./me-cache";

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

export const ORG_KEY = "wa_crm_session";
export const PLATFORM_KEY = "wa_platform_session";
const ORG_LOGOUT_KEY = "wa_org_logged_out";
const PLATFORM_LOGOUT_KEY = "wa_platform_logged_out";

function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  if (sessionStorage.getItem(ORG_LOGOUT_KEY) === "1") return null;
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
  if (sessionStorage.getItem(PLATFORM_LOGOUT_KEY) === "1") return null;
  const raw = localStorage.getItem(PLATFORM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlatformSession;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  sessionStorage.removeItem(ORG_LOGOUT_KEY);
  localStorage.setItem(ORG_KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(ORG_LOGOUT_KEY, "1");
  }
  localStorage.removeItem(ORG_KEY);
  clearOrgMeCache();
}

export function getSession() {
  return loadSession();
}

export function savePlatformSession(session: PlatformSession) {
  sessionStorage.removeItem(PLATFORM_LOGOUT_KEY);
  localStorage.setItem(PLATFORM_KEY, JSON.stringify(session));
}

export function clearPlatformSession() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(PLATFORM_LOGOUT_KEY, "1");
  }
  localStorage.removeItem(PLATFORM_KEY);
  clearPlatformMeCache();
}

export function getPlatformSession() {
  return loadPlatformSession();
}

export function isNetworkErrorMessage(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("ارتباط با سرور")
  );
}

function redirectToLogin(platform: boolean) {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (platform) {
    if (!path.startsWith("/super/login")) {
      window.location.href = "/super/login";
    }
    return;
  }
  if (!path.startsWith("/login") && !path.startsWith("/onboarding")) {
    window.location.href = "/login";
  }
}

let orgRefreshInFlight: Promise<boolean> | null = null;
let platformRefreshInFlight: Promise<boolean> | null = null;

async function refreshOrgSession(): Promise<boolean> {
  const session = loadSession();
  if (!session?.refresh_token) return false;
  if (orgRefreshInFlight) return orgRefreshInFlight;
  orgRefreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: session.refresh_token,
          org_id: session.org_id
        })
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Session>;
      if (!res.ok) return false;
      saveSession({
        ...session,
        access_token: String(data.access_token || session.access_token),
        refresh_token: String(data.refresh_token || session.refresh_token),
        user_id: String(data.user_id || session.user_id),
        org_id: String(data.org_id || session.org_id),
        role: String(data.role || session.role)
      });
      return true;
    } catch {
      return false;
    } finally {
      orgRefreshInFlight = null;
    }
  })();
  return orgRefreshInFlight;
}

async function refreshPlatformSession(): Promise<boolean> {
  const session = loadPlatformSession();
  if (!session?.refresh_token) return false;
  if (platformRefreshInFlight) return platformRefreshInFlight;
  platformRefreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/admin/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      const data = (await res.json().catch(() => ({}))) as Partial<PlatformSession>;
      if (!res.ok) return false;
      savePlatformSession({
        ...session,
        access_token: String(data.access_token || session.access_token),
        refresh_token: String(data.refresh_token || session.refresh_token),
        user_id: String(data.user_id || session.user_id),
        role: String(data.role || session.role || "super_admin"),
        scope: "platform"
      });
      return true;
    } catch {
      return false;
    } finally {
      platformRefreshInFlight = null;
    }
  })();
  return platformRefreshInFlight;
}

export async function logoutOrg() {
  const session = loadSession();
  clearSession();
  if (session?.refresh_token) {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
    } catch {
      /* local session already cleared */
    }
  }
}

export async function logoutPlatform() {
  const session = loadPlatformSession();
  clearPlatformSession();
  if (session?.refresh_token) {
    try {
      await fetch(`${API_URL}/admin/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
    } catch {
      /* local session already cleared */
    }
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & {
    auth?: boolean;
    platform?: boolean;
    _retried?: boolean;
  } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  const platform = !!options.platform;

  if (options.auth !== false) {
    if (platform) {
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

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ارتباط با سرور برقرار نشد";
    throw new Error(isNetworkErrorMessage(msg) ? "ارتباط با سرور برقرار نشد — بعداً دوباره تلاش کنید" : msg);
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && options.auth !== false && !options._retried) {
    const refreshed = platform ? await refreshPlatformSession() : await refreshOrgSession();
    if (refreshed) {
      return api<T>(path, { ...options, _retried: true });
    }
    if (platform) {
      clearPlatformSession();
      redirectToLogin(true);
    } else {
      clearSession();
      redirectToLogin(false);
    }
    const detail = data.detail || data.message || "نشست منقضی شده — دوباره وارد شوید";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  if (!res.ok) {
    const detail = data.detail || data.message || "خطای سرور";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}
