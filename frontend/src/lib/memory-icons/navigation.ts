import { defineIcons } from "./defineIcons";

export const NAVIGATION_ICONS = defineIcons("Navigation", {
  "dashboard": {
    label: "Dashboard",
    paths: [
      '<rect x="3" y="3" width="7.5" height="8" rx="2.3"/>',
      '<rect x="13.5" y="3" width="7.5" height="5" rx="2"/>',
      '<rect x="13.5" y="10.5" width="7.5" height="10.5" rx="2.3"/>',
      '<rect x="3" y="13.5" width="7.5" height="7.5" rx="2.3"/>',
    ],
  },
  "home": {
    label: "Home",
    paths: [
      '<path d="M4.3 11.4L12 4.4L19.7 11.4"/>',
      '<path d="M5.9 10.5V18.4C5.9 19.3 6.6 20 7.5 20H16.5C17.4 20 18.1 19.3 18.1 18.4V10.5"/>',
      '<path d="M10 20V15.4C10 14.8 10.5 14.3 11.1 14.3H12.9C13.5 14.3 14 14.8 14 15.4V20"/>',
      '<circle cx="12" cy="4.2" r="1.35" fill="currentColor" stroke="none"/>',
    ],
  },
  "search": {
    label: "Search",
    paths: [
      '<circle cx="10.5" cy="10.5" r="6.3"/>',
      '<path d="M15.2 15.2L20 20"/>',
      '<circle cx="20" cy="20" r="1.3" fill="currentColor" stroke="none"/>',
    ],
  },
  "spaces": {
    label: "Spaces",
    paths: [
      '<rect x="6.5" y="3.5" width="14" height="11.5" rx="3"/>',
      '<rect x="3.5" y="9.5" width="14" height="11" rx="3"/>',
    ],
  },
  "folder": {
    label: "Folder",
    paths: [
      '<path d="M3.5 7C3.5 5.9 4.4 5 5.5 5H8.9L11.1 7.6H18.5C19.6 7.6 20.5 8.5 20.5 9.6V17C20.5 18.1 19.6 19 18.5 19H5.5C4.4 19 3.5 18.1 3.5 17V7Z"/>',
      '<circle cx="9.7" cy="13.7" r="1.3" fill="currentColor" stroke="none"/>',
      '<circle cx="14.3" cy="13.7" r="1.3" fill="currentColor" stroke="none"/>',
      '<path d="M11 13.7H13"/>',
    ],
  },
  "document": {
    label: "Documents",
    paths: [
      '<path d="M6.5 3.5H13L17.5 8V19C17.5 19.8 16.8 20.5 16 20.5H6.5C5.7 20.5 5 19.8 5 19V5C5 4.2 5.7 3.5 6.5 3.5Z"/>',
      '<path d="M13 3.5V8H17.5"/>',
      '<circle cx="8.4" cy="12.6" r="1.1" fill="currentColor" stroke="none"/>',
      '<circle cx="8.4" cy="16.1" r="1.1" fill="currentColor" stroke="none"/>',
      '<path d="M10.4 12.6H14.6M10.4 16.1H14.6"/>',
    ],
  },
  "note": {
    label: "Notes",
    paths: [
      '<rect x="4.5" y="3.5" width="15" height="17" rx="3"/>',
      '<circle cx="8.4" cy="8.6" r="1.1" fill="currentColor" stroke="none"/>',
      '<circle cx="8.4" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
      '<circle cx="8.4" cy="15.4" r="1.1" fill="currentColor" stroke="none"/>',
      '<path d="M10.4 8.6H15.7M10.4 12H15.7M10.4 15.4H13.6"/>',
    ],
  },
  "bookmark": {
    label: "Saved",
    paths: [
      '<path d="M6.5 4.5C6.5 3.7 7.2 3 8 3H16C16.8 3 17.5 3.7 17.5 4.5V20.5L12 16.3L6.5 20.5V4.5Z"/>',
    ],
  },
  "chat": {
    label: "Chat",
    paths: [
      '<path d="M4 7C4 5.9 4.9 5 6 5H18C19.1 5 20 5.9 20 7V14C20 15.1 19.1 16 18 16H10.5L6 19.5V16C4.9 16 4 15.1 4 14V7Z"/>',
      '<circle cx="9" cy="10.5" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="15" cy="10.5" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "integrations": {
    label: "Integrations",
    paths: [
      '<rect x="3.5" y="3.5" width="9" height="9" rx="2.6"/>',
      '<rect x="11.5" y="11.5" width="9" height="9" rx="2.6"/>',
      '<path d="M10.2 10.2L13.8 13.8"/>',
    ],
  },
  "connector": {
    label: "Connectors",
    paths: [
      '<rect x="2.5" y="9" width="6" height="6" rx="1.9"/>',
      '<rect x="15.5" y="9" width="6" height="6" rx="1.9"/>',
      '<path d="M8.5 12H15.5"/>',
      '<circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/>',
    ],
  },
});
