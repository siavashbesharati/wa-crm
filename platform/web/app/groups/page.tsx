"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import {
  accountIdentity,
  isAccountOn,
  type ChannelAccount
} from "@/components/channels/shared";

type WaGroup = {
  jid: string;
  subject: string;
  size: number;
  owner?: string;
};

type WaParticipant = {
  id: string;
  lid?: string;
  jid?: string;
  phone?: string;
  name?: string;
  admin?: string | null;
  is_admin?: boolean;
};

function downloadCsv(filename: string, rows: string[][]) {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const bom = "\uFEFF";
  const body = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Force a phone-number cell to be treated as text by Excel.
 *
 * Excel auto-converts long digit strings to a number when opening a CSV,
 * which strips leading zeros and breaks the readability. We prepend an
 * apostrophe inside the quoted CSV cell — Excel honours it as a
 * "force-as-text" marker and displays the digits cleanly.
 */
function asExcelText(v: string): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  // Only force-text if the value is purely digits (i.e. looks like a number).
  // If the user has weird non-digit data, just return it as-is.
  if (/^\d+$/.test(s)) return `'${s}`;
  return s;
}

export default function GroupsPage() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupsAccountId, setGroupsAccountId] = useState("");
  const [groups, setGroups] = useState<WaGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [membersBusyJid, setMembersBusyJid] = useState("");
  const toast = useToast();

  const baileysOnline = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.channel === "whatsapp" &&
          (a.connector_type || "") === "baileys" &&
          isAccountOn(a.status, a.pairing_state)
      ),
    [accounts]
  );

  useEffect(() => {
    setLoading(true);
    api<ChannelAccount[]>("/channels/accounts")
      .then(setAccounts)
      .catch((e) => toast.push(e instanceof Error ? e.message : "خطا", "err"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!groupsAccountId && baileysOnline[0]) {
      setGroupsAccountId(baileysOnline[0].id);
    }
  }, [baileysOnline, groupsAccountId]);

  async function loadGroups() {
    if (!groupsAccountId) {
      toast.push("یک اکانت واتساپ متصل انتخاب کنید", "err");
      return;
    }
    setGroupsLoading(true);
    try {
      const res = await api<{ groups: WaGroup[] }>(`/channels/accounts/${groupsAccountId}/groups`);
      setGroups(Array.isArray(res.groups) ? res.groups : []);
      toast.push(`${(res.groups || []).length} گروه پیدا شد`, "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در دریافت گروه‌ها", "err");
    } finally {
      setGroupsLoading(false);
    }
  }

  async function downloadMembers(group: WaGroup) {
    if (!groupsAccountId) return;
    setMembersBusyJid(group.jid);
    try {
      const q = new URLSearchParams({ jid: group.jid });
      const res = await api<{
        subject?: string;
        group_jid?: string;
        participants: WaParticipant[];
      }>(`/channels/accounts/${groupsAccountId}/groups/participants?${q.toString()}`);
      const groupName = res.subject || group.subject || "";
      // 4 columns: phone, name, group name, isAdmin
      // The `asExcelText` helper prepends an apostrophe to phone cells so
      // Excel keeps them as text (avoids the "9.89E+11" / leading-zero loss).
      const rows: string[][] = [["phone", "name", "group name", "isAdmin"]];
      for (const p of res.participants || []) {
        const isAdmin =
          p.admin === "superadmin" || p.is_admin || p.admin === "admin"
            ? "yes"
            : "no";
        rows.push([
          asExcelText(p.phone || ""),
          p.name || "",
          groupName,
          isAdmin,
        ]);
      }
      const safeName = (group.subject || "group").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
      downloadCsv(`wa-group-${safeName}-members.csv`, rows);
      toast.push(`${(res.participants || []).length} عضو دانلود شد`, "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در دانلود اعضا", "err");
    } finally {
      setMembersBusyJid("");
    }
  }

  return (
    <Shell title="گروه‌های واتساپ" sub="لیست گروه‌ها و دانلود اعضا">
      {loading ? (
        <PageLoading variant="list" />
      ) : (
        <Card
          title="گروه‌ها"
          help={{
            title: "لیست و اعضا",
            body: "گروه‌هایی که این شماره عضو آن‌هاست را ببینید و لیست اعضا را CSV دانلود کنید.",
            tips: [
              "فقط اکانت واتساپ متصل.",
              "بعضی اعضا ممکن است فقط شناسه LID داشته باشند.",
              "دانلود پیاپی می‌تواند محدودیت واتساپ ایجاد کند."
            ]
          }}
        >
          {baileysOnline.length === 0 ? (
            <EmptyState
              title="واتساپ متصل نیست"
              text="اول یک شماره واتساپ را در کانال‌ها وصل کنید."
              action={
                <Link href="/channels" className="btn primary">
                  رفتن به کانال‌ها
                </Link>
              }
            />
          ) : (
            <>
              <div className="groups-toolbar">
                <label>
                  اکانت
                  <select
                    value={groupsAccountId}
                    onChange={(e) => {
                      setGroupsAccountId(e.target.value);
                      setGroups([]);
                    }}
                  >
                    {baileysOnline.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label || accountIdentity(a)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button loading={groupsLoading} disabled={!groupsAccountId} onClick={() => void loadGroups()}>
                  دریافت لیست گروه‌ها
                </Button>
              </div>

              {groups.length > 0 ? (
                <>
                  <div className="leads-desktop-only">
                    <table>
                      <thead>
                        <tr>
                          <th>نام گروه</th>
                          <th>تعداد اعضا</th>
                          <th>JID</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g) => (
                          <tr key={g.jid}>
                            <td>{g.subject || "(بدون نام)"}</td>
                            <td>{g.size}</td>
                            <td>
                              <span dir="ltr" className="hint">
                                {g.jid}
                              </span>
                            </td>
                            <td>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={membersBusyJid === g.jid}
                                onClick={() => void downloadMembers(g)}
                              >
                                دانلود اعضا
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="leads-mobile-only">
                    <div className="leads-card-list">
                      {groups.map((g) => (
                        <article key={g.jid} className="leads-card">
                          <div className="leads-card-top">
                            <div>
                              <h3 className="leads-card-name">{g.subject || "(بدون نام)"}</h3>
                              <div className="leads-card-meta">
                                <span>{g.size.toLocaleString("fa-IR")} عضو</span>
                              </div>
                              <div className="hint" dir="ltr" style={{ marginTop: 4 }}>
                                {g.jid}
                              </div>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={membersBusyJid === g.jid}
                              onClick={() => void downloadMembers(g)}
                            >
                              دانلود اعضا
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="hint" style={{ marginTop: 12 }}>
                  روی «دریافت لیست گروه‌ها» بزنید.
                </p>
              )}
            </>
          )}
        </Card>
      )}
    </Shell>
  );
}
