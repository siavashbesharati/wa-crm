"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Lead = { id: string; name: string; stage: string; tags: string[]; phone: string };

const STAGES = ["جدید", "پیگیری", "پیشنهاد", "خرید", "بسته"];

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);

  async function load() {
    setLeads(await api<Lead[]>("/leads"));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function move(id: string, stage: string) {
    await api(`/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ stage })
    });
    await load();
  }

  return (
    <Shell title="پایپلاین" sub="برد مراحل فروش — تغییر مرحله از روی کارت">
      <div className="pipeline">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          return (
            <div className="pipeline-col" key={stage}>
              <h3>
                {stage} ({items.length})
              </h3>
              {items.map((l) => (
                <div className="pipeline-card" key={l.id}>
                  <strong>{l.name}</strong>
                  <div className="hint">{l.phone || "بدون تلفن"}</div>
                  <select value={l.stage} onChange={(e) => move(l.id, e.target.value)}>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
