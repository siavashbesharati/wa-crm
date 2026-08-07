import { api } from "@/lib/api";

export type OrgMe = {
  org: {
    name: string;
    plan?: string;
    plan_label?: string;
    limits?: { label?: string };
    days_remaining?: number | null;
  };
  user: { display_name: string; phone: string };
  needs_onboarding?: boolean;
  onboarding_step?: string;
};

export type PlatformMe = {
  user: { display_name: string; phone: string };
};

let orgMe: OrgMe | null = null;
let orgPromise: Promise<OrgMe> | null = null;
let platformMe: PlatformMe | null = null;
let platformPromise: Promise<PlatformMe> | null = null;

export function getCachedOrgMe() {
  return orgMe;
}

export function clearOrgMeCache() {
  orgMe = null;
  orgPromise = null;
}

export function loadOrgMe(force = false): Promise<OrgMe> {
  if (!force && orgMe) return Promise.resolve(orgMe);
  if (!force && orgPromise) return orgPromise;
  orgPromise = api<OrgMe>("/auth/me")
    .then((me) => {
      orgMe = me;
      return me;
    })
    .finally(() => {
      orgPromise = null;
    });
  return orgPromise;
}

export function getCachedPlatformMe() {
  return platformMe;
}

export function clearPlatformMeCache() {
  platformMe = null;
  platformPromise = null;
}

export function loadPlatformMe(force = false): Promise<PlatformMe> {
  if (!force && platformMe) return Promise.resolve(platformMe);
  if (!force && platformPromise) return platformPromise;
  platformPromise = api<PlatformMe>("/admin/me", { platform: true })
    .then((me) => {
      platformMe = me;
      return me;
    })
    .finally(() => {
      platformPromise = null;
    });
  return platformPromise;
}
