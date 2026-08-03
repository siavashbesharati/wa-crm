"use client";

import { Spinner } from "./Spinner";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "sm";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  className = "",
  disabled,
  ...rest
}: Props) {
  const variantClass =
    variant === "secondary"
      ? "secondary"
      : variant === "danger"
        ? "danger"
        : variant === "ghost"
          ? "ghost"
          : "";
  return (
    <button
      className={`btn ${variantClass} ${size === "sm" ? "sm" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner dark={variant !== "primary"} />}
      {children}
    </button>
  );
}
