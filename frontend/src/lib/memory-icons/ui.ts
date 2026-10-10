import { defineIcons } from "./defineIcons";

export const UI_ICONS = defineIcons("UI", {
  "menu": {
    label: "Menu",
    paths: [
      '<path d="M4.5 7H19.5M4.5 12H19.5M4.5 17H19.5"/>',
    ],
  },
  "close": {
    label: "Close",
    paths: [
      '<path d="M6.4 6.4L17.6 17.6M17.6 6.4L6.4 17.6"/>',
    ],
  },
  "check": {
    label: "Done",
    paths: [
      '<path d="M5 12.6L9.8 17.4L19 7"/>',
    ],
  },
  "sidebar": {
    label: "Toggle Sidebar",
    paths: [
      '<rect x="3.5" y="4.5" width="17" height="15" rx="2.8"/>',
      '<path d="M9.5 4.5V19.5"/>',
      '<circle cx="6.5" cy="8" r="1" fill="currentColor" stroke="none"/>',
      '<circle cx="6.5" cy="11.2" r="1" fill="currentColor" stroke="none"/>',
    ],
  },
  "grid-view": {
    label: "Grid View",
    paths: [
      '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/>',
      '<rect x="13.5" y="3.5" width="7" height="7" rx="2"/>',
      '<rect x="3.5" y="13.5" width="7" height="7" rx="2"/>',
      '<rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    ],
  },
  "list-view": {
    label: "List View",
    paths: [
      '<path d="M9.5 6H20M9.5 12H20M9.5 18H20"/>',
      '<circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/>',
      '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
      '<circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"/>',
    ],
  },
  "chevron-down": {
    label: "Chevron",
    paths: [
      '<path d="M5.8 9.5L12 15.7L18.2 9.5"/>',
    ],
  },
  "chevron-right": {
    label: "Chevron Right",
    paths: [
      '<path d="M9.5 5.8L15.7 12L9.5 18.2"/>',
    ],
  },
  "more": {
    label: "More",
    paths: [
      '<circle cx="5.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
      '<circle cx="18.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
    ],
  },
  "eye": {
    label: "View",
    paths: [
      '<path d="M2.6 12C2.6 12 6.2 6.2 12 6.2C17.8 6.2 21.4 12 21.4 12C21.4 12 17.8 17.8 12 17.8C6.2 17.8 2.6 12 2.6 12Z"/>',
      '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>',
    ],
  },
});
