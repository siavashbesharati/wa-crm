"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastItem = { id: number; message: string; kind: "ok" | "err" | "info"; leaving?: boolean };

type ToastCtx = {
  push: (message: string, kind?: ToastItem["kind"]) => void;
};

const Ctx = createContext<ToastCtx>({ push: () => undefined });
const LIFE_MS = 5000;
const OUT_MS = 180;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, OUT_MS);
  }, []);

  const push = useCallback(
    (message: string, kind: ToastItem["kind"] = "info") => {
      const id = Date.now() + Math.random();
      setItems((prev) => [{ id, message, kind }, ...prev]);
      const t = window.setTimeout(() => dismiss(id), LIFE_MS);
      timers.current.set(id, t);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind === "ok" ? "ok" : t.kind === "err" ? "err" : ""}${t.leaving ? " leaving" : ""}`}
            role="status"
          >
            <span className="toast-msg">{t.message}</span>
            <button type="button" className="toast-x" aria-label="بستن" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
