import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
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
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HubSpot = ({ size = 28, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...p}>
    <path d="M16.2 9.1V6.4a2 2 0 1 0-1.7 0v2.7a5.6 5.6 0 0 0-2.4 1.1L6.6 6.1a2.3 2.3 0 1 0-1 1.3l5.4 4.2a5.5 5.5 0 1 0 5.2-2.5Zm-1.3 8.4a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8Z" fill="#ff6b3e" />
  </svg>
);

export const Bell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 5 2 6 2 6H4.5s2-1 2-6Z" />
    <path d="M10 19.5a2 2 0 0 0 4 0" />
  </Svg>
);

export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="m20 20-3.6-3.6" />
  </Svg>
);

export const Sliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h6M15 17h4" />
    <circle cx="15.5" cy="7" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="17" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const ArrowUpRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Svg>
);

export const ArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const Calendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3.2" />
    <path d="M3.5 9.5h17M8 3.4v3.4M16 3.4v3.4" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Target = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="4.4" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const Grid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </Svg>
);

export const Contacts = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3.1" />
    <path d="M3.6 19c.6-3 2.8-4.7 5.4-4.7s4.8 1.7 5.4 4.7" />
    <path d="M16 5.2a3 3 0 0 1 0 5.8M17.4 14.6c2 .5 3.4 2 3.9 4.4" />
  </Svg>
);

export const Chat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16.5H9l-4 3.5V7A1.5 1.5 0 0 1 6.5 5.5Z" />
    <path d="M8.5 10.5h7M8.5 13h4" />
  </Svg>
);

export const CalDays = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3.2" />
    <path d="M3.5 9.5h17" />
    <circle cx="8" cy="13" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="13" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="16.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const Flame = ({ size = 16, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...p}>
    <path d="M12 3s5 3.6 5 8.4a5 5 0 0 1-10 0c0-1.3.5-2.4 1.2-3.2.1 1.2.9 2 1.8 2 .8 0 .9-.7.6-1.7C10 6.6 12 4.4 12 3Z" fill="#ff6b3e" />
  </svg>
);

export const Mail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.6" />
    <path d="m4.5 7.5 7.5 5 7.5-5" />
  </Svg>
);

export const Video = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.6" />
    <path d="m15.5 10 5-2.6v9.2l-5-2.6" />
  </Svg>
);

export const Mic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3" />
  </Svg>
);

export const Speaker = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 7a7 7 0 0 1 0 10" />
  </Svg>
);

export const PhoneHangup = ({ size = 20, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" {...p}>
    <path d="M3.5 14.2c5-4.3 12-4.3 17 0 .8.7.9 1.9.2 2.7l-1.3 1.4c-.6.7-1.6.8-2.3.3l-1.9-1.3a1.7 1.7 0 0 1-.7-1.6l.2-1.3a9.6 9.6 0 0 0-5.6 0l.2 1.3a1.7 1.7 0 0 1-.7 1.6L6.9 18.6c-.7.5-1.7.4-2.3-.3l-1.3-1.4c-.7-.8-.6-2 .2-2.7Z" fill="#fff" stroke="none" />
  </svg>
);

export const Expand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4H5.5C4.7 4 4 4.7 4 5.5V9M15 4h3.5c.8 0 1.5.7 1.5 1.5V9M9 20H5.5C4.7 20 4 19.3 4 18.5V15M15 20h3.5c.8 0 1.5-.7 1.5-1.5V15" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const Edit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m13.5 6.5 3 3" />
  </Svg>
);

export const Download = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v10M8 10.5l4 4 4-4M5 18.5h14" />
  </Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);


export const DocThumb = ({ size = 20, ...p }: IconProps) => (
  <Svg {...p}>
    <path d="M7 3.5h7L18 7.5V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" />
    <path d="M13.5 3.6V8h4.4" />
  </Svg>
);

export const Menu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 9.5h11M6.5 12h11M6.5 14.5h11" />
  </Svg>
);

export const Cog = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9M18.6 18.6l-1.9-1.9M7.3 7.3 5.4 5.4" />
  </Svg>
);

export const ListChecks = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 7 1.6 1.6L8 5M3 16l1.6 1.6L8 14M11.5 7h9.5M11.5 16h9.5" />
  </Svg>
);

export const Globe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="7.3" />
    <path d="M3.5 10.8h14.6M10.8 3.5c2.4 2 2.4 12.6 0 14.6M10.8 3.5c-2.4 2-2.4 12.6 0 14.6" />
    <path d="m20.5 20.5-3.2-3.2" />
  </Svg>
);

export const Board = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="7" height="15" rx="2" />
    <rect x="13.5" y="4.5" width="7" height="9" rx="2" />
  </Svg>
);
