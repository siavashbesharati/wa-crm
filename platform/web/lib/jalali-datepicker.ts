"use client";

type JalaliDatepickerApi = {
  startWatch: (options?: Record<string, unknown>) => void;
  show: (input: HTMLInputElement) => void;
  hide: () => void;
};

declare global {
  interface Window {
    jalaliDatepicker?: JalaliDatepickerApi;
  }
}

let started = false;
let starting: Promise<JalaliDatepickerApi | null> | null = null;

export async function ensureJalaliDatepicker(): Promise<JalaliDatepickerApi | null> {
  if (typeof window === "undefined") return null;
  if (started && window.jalaliDatepicker) return window.jalaliDatepicker;
  if (starting) return starting;

  starting = (async () => {
    await import("@majidh1/jalalidatepicker/dist/jalalidatepicker.min.js");
    const api = window.jalaliDatepicker;
    if (!api) return null;
    if (!started) {
      api.startWatch({
        selector: "input[data-jdp]",
        zIndex: 4000,
        date: true,
        time: false,
        showTodayBtn: true,
        showEmptyBtn: true,
        hideAfterChange: true,
        autoReadOnlyInput: true,
        autoShow: true,
        autoHide: true,
        position: "right"
      });
      started = true;
    }
    return api;
  })();

  return starting;
}
