import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fc-logo-grad" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6ea8fe" />
          <stop offset="0.55" stopColor="#8b7bff" />
          <stop offset="1" stopColor="#3ddc97" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="3" width="12" height="9" rx="3" fill="url(#fc-logo-grad)" opacity="0.95" />
      <rect x="17.5" y="20" width="12" height="9" rx="3" fill="url(#fc-logo-grad)" opacity="0.95" />
      <path d="M14.5 7.5h3.2a4 4 0 0 1 4 4v4.2a4 4 0 0 0 4 4h2.3" stroke="url(#fc-logo-grad)" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="24" cy="7.5" r="2.4" fill="#3ddc97" />
      <circle cx="8" cy="24.5" r="2.4" fill="#6ea8fe" />
    </svg>
  );
}

export const Search = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
);
export const Plus = (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const X = (p: IconProps) => <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>;
export const Refresh = (p: IconProps) => (
  <Svg {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Svg>
);
export const Layout = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="7" height="7" rx="1.6" /><rect x="14" y="13" width="7" height="7" rx="1.6" /><path d="M10 7.5h2.5a1.5 1.5 0 0 1 1.5 1.5v2.5M14 16.5h-2.5A1.5 1.5 0 0 1 10 15v-2.5" /></Svg>
);
export const Fit = (p: IconProps) => (
  <Svg {...p}><path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" /><rect x="8" y="8" width="8" height="8" rx="1.5" opacity="0.55" /></Svg>
);
export const Undo = (p: IconProps) => (
  <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Svg>
);
export const Redo = (p: IconProps) => (
  <Svg {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Svg>
);
export const ChevronLeft = (p: IconProps) => <Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>;
export const ChevronRight = (p: IconProps) => <Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>;
export const ChevronDown = (p: IconProps) => <Svg {...p}><path d="m5 9 7 7 7-7" /></Svg>;
export const Code = (p: IconProps) => <Svg {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" /></Svg>;
export const Copy = (p: IconProps) => (
  <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A1.5 1.5 0 0 0 5.5 15" /></Svg>
);
export const Check = (p: IconProps) => <Svg {...p}><path d="m4.5 12.5 5 5 10-11" /></Svg>;
export const Trash = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" /><path d="M10 11v6M14 11v6" /></Svg>
);
export const ExternalLink = (p: IconProps) => (
  <Svg {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></Svg>
);
export const Settings = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.7 18.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.04 14.7a1.7 1.7 0 0 0-1.56-1.03H5v-3h.08A1.7 1.7 0 0 0 6.6 9.64a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06A1.7 1.7 0 0 0 10.26 6a1.7 1.7 0 0 0 1.03-1.56V4h3v.08A1.7 1.7 0 0 0 15.32 5.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19 9.26v.08A1.7 1.7 0 0 0 20.56 10.4H21v3h-.08A1.7 1.7 0 0 0 19.4 15Z" /></Svg>
);
export const More = (p: IconProps) => <Svg {...p}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></Svg>;
export const Warning = (p: IconProps) => (
  <Svg {...p}><path d="M10.3 4.3 2.7 17.5A1.7 1.7 0 0 0 4.2 20h15.6a1.7 1.7 0 0 0 1.5-2.5L13.7 4.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9v5M12 17.2v.2" /></Svg>
);
export const Sparkles = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z" /><path d="M19 16.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></Svg>
);
export const ArrowRight = (p: IconProps) => <Svg {...p}><path d="M4 12h15M14 6l6 6-6 6" /></Svg>;
export const ArrowDownToLine = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 20h16" /></Svg>
);
export const Download = (p: IconProps) => <Svg {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 20h16" /></Svg>;
export const Upload = (p: IconProps) => <Svg {...p}><path d="M12 21V9M7 14l5-5 5 5" /><path d="M4 4h16" /></Svg>;
export const Help = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 4.9.7c0 1.6-2.4 2-2.4 3.6M12 17.2v.2" /></Svg>
);
export const PanelRight = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Svg>
);
export const MousePointer = (p: IconProps) => (
  <Svg {...p}><path d="m5 3 14 8-6.3 1.7L9 19 5 3Z" /></Svg>
);
export const Link2 = (p: IconProps) => (
  <Svg {...p}><path d="M9.5 14.5 14.5 9.5" /><path d="M7.5 12.5 5.6 14.4a3.8 3.8 0 0 0 5.4 5.4l1.9-1.9M16.5 11.5l1.9-1.9a3.8 3.8 0 0 0-5.4-5.4l-1.9 1.9" /></Svg>
);
export const Braces = (p: IconProps) => (
  <Svg {...p}><path d="M8 4H6.5A2.5 2.5 0 0 0 4 6.5v3A2.5 2.5 0 0 1 1.5 12 2.5 2.5 0 0 1 4 14.5v3A2.5 2.5 0 0 0 6.5 20H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5v3a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5H16" /></Svg>
);
export const FileCode = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M10 12l-2 2 2 2M14 12l2 2-2 2" /></Svg>
);
export const Play = (p: IconProps) => <Svg {...p}><path d="M7 4.5v15l12-7.5-12-7.5Z" /></Svg>;
export const Dot = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></Svg>;
