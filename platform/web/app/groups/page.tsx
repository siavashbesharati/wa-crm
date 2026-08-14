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
      const rows: string[][] = [["phone", "jid", "id", "lid", "admin", "group_subject", "group_jid"]];
      for (const p of res.participants || []) {
        rows.push([
          p.phone || "",
          p.jid || "",
          p.id || "",
          p.lid || "",
          p.admin || (p.is_admin ? "admin" : ""),
          res.subject || group.subject || "",
          res.group_jid || group.jid
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
