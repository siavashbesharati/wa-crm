"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

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
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setPolicy(await api<Policy>("/ai/policy"));
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function save() {
    if (!policy) return;
    await run(
      () => api("/ai/policy", { method: "PUT", body: JSON.stringify(policy) }),
      { success: "سیاست ذخیره شد" }
    );
  }

  return (
    <Shell title="تنظیمات AI" sub="پیشنهاد و ارسال خودکار با سیاست سازمان">
      {loading || !policy ? (
        <PageLoading />
      ) : (
        <Card title="سیاست پاسخ">
          <div className="form-grid">
            <label className="full check">
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
                    allowed_stages: e.target.value
                      .split(/[,،]/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </label>
            <p className="hint full">
              پلن: suggest={String(policy.plan_allows_suggest)} / auto=
              {String(policy.plan_allows_auto)}
            </p>
            <Button loading={busy} onClick={save}>
              ذخیره سیاست
            </Button>
          </div>
        </Card>
      )}
    </Shell>
  );
}
