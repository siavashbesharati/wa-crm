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

export function Skeleton({
  height = 16,
  width = "100%",
  className = ""
}: {
  height?: number;
  width?: string | number;
  className?: string;
}) {
  return <div className={`skeleton ${className}`.trim()} style={{ height, width }} />;
}

/** Page-level shimmer while route data loads (keeps shell chrome visible). */
export function PageLoading({
  label = "در حال بارگذاری…",
  variant = "page"
}: {
  label?: string;
  variant?: "page" | "compact" | "list";
}) {
  if (variant === "compact") {
    return (
      <div className="page-shimmer page-shimmer-compact" aria-busy="true" aria-label={label}>
        <Skeleton height={18} width="40%" />
        <Skeleton height={12} width="70%" />
        <Skeleton height={12} width="55%" />
        <Skeleton height={96} />
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className="page-shimmer" aria-busy="true" aria-label={label}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="shimmer-list-row">
            <Skeleton height={14} width="28%" />
            <Skeleton height={12} width="55%" />
            <Skeleton height={12} width="40%" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="page-shimmer" aria-busy="true" aria-label={label}>
      <Skeleton height={92} className="shimmer-block" />
      <div className="shimmer-stats">
        <Skeleton height={76} className="shimmer-block" />
        <Skeleton height={76} className="shimmer-block" />
        <Skeleton height={76} className="shimmer-block" />
        <Skeleton height={76} className="shimmer-block" />
      </div>
      <Skeleton height={160} className="shimmer-block" />
      <Skeleton height={120} className="shimmer-block" />
    </div>
  );
}
