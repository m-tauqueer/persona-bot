import { defineIcons } from "./defineIcons";

export const ACTION_ICONS = defineIcons("Actions", {
  "add": {
    label: "Add",
    paths: [
      '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/>',
      '<path d="M12 8V16M8 12H16"/>',
    ],
  },
  "plus": {
    label: "Plus",
    paths: [
      '<path d="M12 4.5V19.5M4.5 12H19.5"/>',
    ],
  },
  "minus": {
    label: "Minus",
    paths: [
      '<path d="M4.5 12H19.5"/>',
    ],
  },
  "upload": {
    label: "Import",
    paths: [
      '<path d="M12 15.5V4.8M8 8.8L12 4.8L16 8.8"/>',
      '<path d="M5 14.5V18C5 19.1 5.9 20 7 20H17C18.1 20 19 19.1 19 18V14.5"/>',
      '<circle cx="5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="19" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "download": {
    label: "Export",
    paths: [
      '<path d="M12 4.8V15.5M8 11.5L12 15.5L16 11.5"/>',
      '<path d="M5 14.5V18C5 19.1 5.9 20 7 20H17C18.1 20 19 19.1 19 18V14.5"/>',
      '<circle cx="5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="19" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "tag": {
    label: "Tag",
    paths: [
      '<path d="M4 11.6V5.6C4 4.7 4.7 4 5.6 4H11.6L20 12.4C20.6 13 20.6 14 20 14.6L14.6 20C14 20.6 13 20.6 12.4 20L4 11.6Z"/>',
      '<circle cx="8.4" cy="8.4" r="1.5" fill="currentColor" stroke="none"/>',
    ],
  },
  "filter": {
    label: "Filter",
    paths: [
      '<path d="M4 5.5H20L13.8 12.6V18.2L10.2 20V12.6L4 5.5Z"/>',
    ],
  },
  "sort": {
    label: "Sort",
    paths: [
      '<path d="M7 19.2V5.8M7 5.8L4.2 8.6M7 5.8L9.8 8.6"/>',
      '<path d="M17 4.8V18.2M17 18.2L14.2 15.4M17 18.2L19.8 15.4"/>',
      '<circle cx="7" cy="19.2" r="1.2" fill="currentColor" stroke="none"/>',
      '<circle cx="17" cy="4.8" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "star": {
    label: "Favorite",
    paths: [
      '<path d="M12 3.6L14.6 8.9L20.4 9.7L16.2 13.8L17.2 19.6L12 16.9L6.8 19.6L7.8 13.8L3.6 9.7L9.4 8.9L12 3.6Z"/>',
    ],
  },
  "pin": {
    label: "Pin",
    paths: [
      '<path d="M9 3.6H15L13.7 9.8L17 13H7L10.3 9.8L9 3.6Z"/>',
      '<path d="M12 13V20.4"/>',
    ],
  },
  "archive": {
    label: "Archive",
    paths: [
      '<rect x="3.5" y="4" width="17" height="4.6" rx="1.7"/>',
      '<path d="M5 8.6V18C5 19.1 5.9 20 7 20H17C18.1 20 19 19.1 19 18V8.6"/>',
      '<path d="M9.5 12.3H14.5"/>',
    ],
  },
  "trash": {
    label: "Delete",
    paths: [
      '<path d="M4.5 6.6H19.5"/>',
      '<path d="M9 6.6V5C9 4.2 9.7 3.5 10.5 3.5H13.5C14.3 3.5 15 4.2 15 5V6.6"/>',
      '<path d="M6.5 6.6L7.3 18.6C7.4 19.7 8.3 20.5 9.4 20.5H14.6C15.7 20.5 16.6 19.7 16.7 18.6L17.5 6.6"/>',
      '<path d="M10 10.5V16.5M14 10.5V16.5"/>',
    ],
  },
  "share": {
    label: "Share",
    paths: [
      '<circle cx="6" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
      '<circle cx="18" cy="6" r="2.6" fill="currentColor" stroke="none"/>',
      '<circle cx="18" cy="18" r="2.6" fill="currentColor" stroke="none"/>',
      '<path d="M8.4 10.8L15.6 7.2M8.4 13.2L15.6 16.8"/>',
    ],
  },
  "edit": {
    label: "Edit",
    paths: [
      '<path d="M14.6 4.6L19.4 9.4L9 19.8L4 21L5.2 16L15.6 5.6L14.6 4.6Z"/>',
      '<path d="M13 6.2L17.8 11"/>',
      '<path d="M4 21L5.2 16L9 19.8L4 21Z" fill="currentColor" stroke="none"/>',
    ],
  },
  "copy": {
    label: "Copy",
    paths: [
      '<rect x="8.5" y="8.5" width="11" height="11" rx="2.8"/>',
      '<path d="M5.5 15.5C4.7 15.5 4 14.8 4 14V6C4 5.2 4.7 4.5 5.5 4.5H13.5C14.3 4.5 15 5.2 15 6V6.5"/>',
    ],
  },
  "link": {
    label: "Link",
    paths: [
      '<path d="M9.8 14.2L14.2 9.8"/>',
      '<path d="M11 6.6L12.6 5C14.3 3.3 17 3.3 18.7 5C20.4 6.7 20.4 9.4 18.7 11.1L17.1 12.7"/>',
      '<path d="M12.9 17.4L11.4 19C9.7 20.7 7 20.7 5.3 19C3.6 17.3 3.6 14.6 5.3 12.9L6.9 11.3"/>',
    ],
  },
  "external": {
    label: "External Link",
    paths: [
      '<path d="M13.5 4.5H19.5V10.5"/>',
      '<path d="M19.5 4.5L11 13"/>',
      '<path d="M16.5 13V18C16.5 19.1 15.6 20 14.5 20H6C4.9 20 4 19.1 4 18V9.5C4 8.4 4.9 7.5 6 7.5H11"/>',
      '<circle cx="11" cy="13" r="1.2" fill="currentColor" stroke="none"/>',
    ],
  },
  "sync": {
    label: "Sync",
    paths: [
      '<path d="M4.5 12C4.5 7.9 7.9 4.5 12 4.5C14.7 4.5 17.1 5.9 18.4 8"/>',
      '<path d="M19.5 4.5V8.5H15.5"/>',
      '<path d="M19.5 12C19.5 16.1 16.1 19.5 12 19.5C9.3 19.5 6.9 18.1 5.6 16"/>',
      '<path d="M4.5 19.5V15.5H8.5"/>',
    ],
  },
});
