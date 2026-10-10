import { defineIcons } from "./defineIcons";

export const SYSTEM_ICONS = defineIcons("System", {
  "bell": {
    label: "Notifications",
    paths: [
      '<path d="M12 4.4C8.8 4.4 6.6 6.6 6.6 9.8V15L5.2 17H18.8L17.4 15V9.8C17.4 6.6 15.2 4.4 12 4.4Z"/>',
      '<path d="M10.1 17.5C10.3 18.6 11.1 19.4 12 19.4C12.9 19.4 13.7 18.6 13.9 17.5"/>',
      '<circle cx="12" cy="4.2" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "calendar": {
    label: "Calendar",
    paths: [
      '<rect x="3.5" y="5" width="17" height="15.5" rx="2.8"/>',
      '<path d="M3.5 9.5H20.5"/>',
      '<path d="M8 3.5V6.5M16 3.5V6.5"/>',
      '<circle cx="8.5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="15.5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "clock": {
    label: "Recent",
    paths: [
      '<circle cx="12" cy="12" r="8.4"/>',
      '<path d="M12 7.6V12L15 13.8"/>',
      '<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    ],
  },
  "history": {
    label: "History",
    paths: [
      '<path d="M4.5 12C4.5 7.9 7.9 4.5 12 4.5C16.1 4.5 19.5 7.9 19.5 12C19.5 16.1 16.1 19.5 12 19.5C9.3 19.5 6.9 18.2 5.6 16.1"/>',
      '<path d="M4.5 19.5V15.5H8.5"/>',
      '<path d="M12 8.2V12L14.8 13.6"/>',
      '<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    ],
  },
  "analytics": {
    label: "Analytics",
    paths: [
      '<path d="M4.5 4V18.2C4.5 19 5 19.5 5.8 19.5H20"/>',
      '<rect x="7.4" y="11.5" width="2.7" height="5.4" rx="1"/>',
      '<rect x="11.8" y="8" width="2.7" height="8.9" rx="1"/>',
      '<rect x="16.2" y="5" width="2.7" height="11.9" rx="1"/>',
    ],
  },
  "trend": {
    label: "Insights",
    paths: [
      '<path d="M4 15.5L9.2 10.3L12.7 13.8L20 6.5"/>',
      '<path d="M14.6 6.5H20V11.9"/>',
    ],
  },
  "database": {
    label: "Data",
    paths: [
      '<ellipse cx="12" cy="6" rx="7.5" ry="3"/>',
      '<path d="M4.5 6V12C4.5 13.7 7.9 15 12 15C16.1 15 19.5 13.7 19.5 12V6"/>',
      '<path d="M4.5 12V18C4.5 19.7 7.9 21 12 21C16.1 21 19.5 19.7 19.5 18V12"/>',
      '<circle cx="12" cy="6" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "api": {
    label: "API / Code",
    paths: [
      '<path d="M8.5 7.7L4.3 12L8.5 16.3"/>',
      '<path d="M15.5 7.7L19.7 12L15.5 16.3"/>',
      '<path d="M13.4 5.4L10.6 18.6"/>',
      '<circle cx="4.3" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="19.7" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "key": {
    label: "Auth Keys",
    paths: [
      '<circle cx="8" cy="8" r="3.8"/>',
      '<path d="M10.8 10.8L19.5 19.5"/>',
      '<path d="M19.5 19.5L17.6 17.6M16 21L17.6 19.4"/>',
      '<circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "shield": {
    label: "Security",
    paths: [
      '<path d="M12 3.5L19 6V11.2C19 16 16 19.5 12 20.5C8 19.5 5 16 5 11.2V6L12 3.5Z"/>',
      '<path d="M9 12L11 14L15 9.5"/>',
    ],
  },
  "billing": {
    label: "Billing",
    paths: [
      '<rect x="3" y="6" width="18" height="12" rx="2.8"/>',
      '<path d="M3 10H21"/>',
      '<rect x="6.3" y="13.4" width="3.6" height="2.6" rx="0.9"/>',
    ],
  },
  "settings": {
    label: "Settings",
    paths: [
      '<circle cx="12" cy="12" r="3.1"/>',
      '<path d="M12 3.6V6.2M12 17.8V20.4M20.4 12H17.8M6.2 12H3.6M18 6L16.2 7.8M7.8 16.2L6 18M18 18L16.2 16.2M7.8 7.8L6 6"/>',
      '<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    ],
  },
  "sliders": {
    label: "Preferences",
    paths: [
      '<path d="M5 7H12M16.9 7H19"/>',
      '<path d="M5 17H7.1M12 17H19"/>',
      '<circle cx="14.4" cy="7" r="2.3" fill="currentColor" stroke="none"/>',
      '<circle cx="9.6" cy="17" r="2.3" fill="currentColor" stroke="none"/>',
    ],
  },
  "help": {
    label: "Help",
    paths: [
      '<circle cx="12" cy="12" r="8.4"/>',
      '<path d="M9.5 9.4C9.5 8 10.6 6.9 12 6.9C13.4 6.9 14.5 8 14.5 9.4C14.5 11.4 12 11.2 12 13.4"/>',
      '<circle cx="12" cy="16.6" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "info": {
    label: "Info",
    paths: [
      '<circle cx="12" cy="12" r="8.4"/>',
      '<path d="M12 11.2V16"/>',
      '<circle cx="12" cy="7.7" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "logout": {
    label: "Sign Out",
    paths: [
      '<path d="M14 4.5H7C5.9 4.5 5 5.4 5 6.5V17.5C5 18.6 5.9 19.5 7 19.5H14"/>',
      '<path d="M11 12H20.5M20.5 12L16.8 8.3M20.5 12L16.8 15.7"/>',
      '<circle cx="11" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "globe": {
    label: "Web",
    paths: [
      '<circle cx="12" cy="12" r="8.4"/>',
      '<path d="M3.6 12H20.4"/>',
      '<path d="M12 3.6C14.4 6 15.6 9 15.6 12C15.6 15 14.4 18 12 20.4C9.6 18 8.4 15 8.4 12C8.4 9 9.6 6 12 3.6Z"/>',
      '<circle cx="12" cy="3.6" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="20.4" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
});
