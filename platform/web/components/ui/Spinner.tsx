"use client";

export function Spinner({
  dark = false,
  lg = false
}: {
  dark?: boolean;
  lg?: boolean;
}) {
  return <span className={`spinner ${dark ? "dark" : ""} ${lg ? "lg" : ""}`} aria-hidden />;
}

export function PageLoading({ label = "در حال بارگذاری…" }: { label?: string }) {
  return (
    <div className="page-loading">
      <Spinner dark lg />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} />;
}
