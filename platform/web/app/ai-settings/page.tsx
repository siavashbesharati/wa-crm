"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Policy = {
  auto_send_enabled: boolean;
  min_confidence: number;
  allowed_stages: string[];
  business_hours_only: boolean;
  hours_start: string;
  hours_end: string;
  plan_allows_auto: boolean;
  plan_allows_suggest: boolean;
};

export default function AiSettingsPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api<Policy>("/ai/policy").then(setPolicy).catch(console.error);
  }, []);

  async function save() {
    if (!policy) return;
    await api("/ai/policy", { method: "PUT", body: JSON.stringify(policy) });
    setMsg("ذخیره شد");
  }

  if (!policy) {
    return (
      <Shell title="تنظیمات AI" sub="سیاست پاسخ خودکار">
        <p>در حال بارگذاری...</p>
      </Shell>
    );
  }

  return (
    <Shell title="تنظیمات AI" sub="پیشنهاد و ارسال خودکار با سیاست سازمان">
      <div className="card form-grid">
        <label className="full check" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={policy.auto_send_enabled}
            onChange={(e) => setPolicy({ ...policy, auto_send_enabled: e.target.checked })}
          />
          فعال‌سازی auto-send (نیاز به پلن Growth/Scale)
        </label>
        <label>
          حداقل اطمینان
          <input
            type="number"
            step="0.01"
            value={policy.min_confidence}
            onChange={(e) =>
              setPolicy({ ...policy, min_confidence: Number(e.target.value) })
            }
          />
        </label>
        <label>
          مراحل مجاز (با ویرگول)
          <input
            value={(policy.allowed_stages || []).join("،")}
            onChange={(e) =>
              setPolicy({
                ...policy,
                allowed_stages: e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean)
              })
            }
          />
        </label>
        <p className="hint full">
          پلن: suggest={String(policy.plan_allows_suggest)} / auto=
          {String(policy.plan_allows_auto)}
        </p>
        <button className="btn" onClick={save}>
          ذخیره سیاست
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </Shell>
  );
}
