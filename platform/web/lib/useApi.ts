"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useToast } from "@/components/ui/Toast";

export function useAsyncLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loaderRef.current();
      setData(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا";
      setError(msg);
      toast.push(msg, "err");
      return null;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

export function useMutation() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const run = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      opts?: { success?: string; error?: string; silent?: boolean }
    ): Promise<T | null> => {
      setBusy(true);
      try {
        const result = await fn();
        if (opts?.success) toast.push(opts.success, "ok");
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : opts?.error || "خطا";
        if (!opts?.silent) toast.push(msg, "err");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );

  return { busy, run };
}

export { api };
