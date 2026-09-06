import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
  /** Flip in RTL for directional icons (chevrons, back). */
  directional?: boolean;
};

function base({ size = 22, directional, className = "", ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: `${directional ? "icon-dir" : ""} ${className}`.trim(),
    ...rest
  };
}

export function IconHome(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}

export function IconInbox(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <path d="M4 13h4.2l1.3 2h5l1.3-2H20" />
    </svg>
  );
}

export function IconPeople(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.2 19a4.2 4.2 0 0 1 5.3-3.6" />
    </svg>
  );
}

export function IconTasks(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6.2 5.8 7.5 8 5.2M4.5 12.2 5.8 13.5 8 11.2M4.5 18.2 5.8 19.5 8 17.2" />
    </svg>
  );
}

export function IconMore(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconChevron(p: IconProps) {
  return (
    <svg {...base({ ...p, directional: true })}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function IconBack(p: IconProps) {
  return (
    <svg {...base({ ...p, directional: true })}>
      <path d="M15 5.5 8.5 12 15 18.5" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

export function IconEdit(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12.5 5.5 18.5 11.5" />
      <path d="M5 19l1.2-5.2L15.5 4.5a1.8 1.8 0 0 1 2.5 0l1.5 1.5a1.8 1.8 0 0 1 0 2.5L10.2 17.8 5 19z" />
    </svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16.2 16.2 20 20" />
    </svg>
  );
}

export function IconCampaigns(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10v4h3l5 4V6L7 10H4z" />
      <path d="M16 9.2a3.5 3.5 0 0 1 0 5.6" />
      <path d="M17.8 7a6 6 0 0 1 0 10" />
    </svg>
  );
}

export function IconChannels(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 8a5 5 0 0 1 10 0v3.5l1.6 2.8a1 1 0 0 1-.9 1.5H6.3a1 1 0 0 1-.9-1.5L7 11.5V8z" />
      <path d="M10 17.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.5M17.5 16l1.6 1.5M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.5M17.5 8l1.6-1.5" />
    </svg>
  );
}

export function IconSpark(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5 13.8 9l5.7.2-4.4 3.6 1.5 5.5L12 15.4 5.4 18.3l1.5-5.5L2.5 9.2 8.2 9 12 3.5z" />
    </svg>
  );
}

export function IconBilling(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 15h3" />
    </svg>
  );
}

export function IconSupport(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.2 9.4a2.8 2.8 0 0 1 5.4 1.1c0 1.7-2.5 2-2.5 3.6" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTeam(p: IconProps) {
  return <IconPeople {...p} />;
}

export function IconGroups(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconKpi(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 19V10M10.5 19V5M16 19v-7M21 19H3" />
    </svg>
  );
}

export function IconLogout(p: IconProps) {
  return (
    <svg {...base({ ...p, directional: true })}>
      <path d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      <path d="M14 12H21M18 8.5 21.5 12 18 15.5" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
