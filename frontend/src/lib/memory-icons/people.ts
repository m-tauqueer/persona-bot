import { defineIcons } from "./defineIcons";

export const PEOPLE_ICONS = defineIcons("People", {
  "user": {
    label: "Profile",
    paths: [
      '<circle cx="12" cy="8" r="3.4" fill="currentColor" stroke="none"/>',
      '<path d="M5.5 19.5C5.5 16 8.4 14 12 14C15.6 14 18.5 16 18.5 19.5"/>',
    ],
  },
  "users": {
    label: "Team",
    paths: [
      '<circle cx="9" cy="8" r="2.9" fill="currentColor" stroke="none"/>',
      '<circle cx="16.2" cy="8.5" r="2.4" fill="currentColor" stroke="none"/>',
      '<path d="M3 19C3 15.7 5.7 14 9 14C12.3 14 15 15.7 15 19"/>',
      '<path d="M16.8 14.2C19.2 14.7 21 16.4 21 19"/>',
    ],
  },
  "user-add": {
    label: "Add Member",
    paths: [
      '<circle cx="9.5" cy="8" r="3.2" fill="currentColor" stroke="none"/>',
      '<path d="M4 19.5C4 16 6.6 14 9.5 14C10.4 14 11.3 14.2 12 14.5"/>',
      '<path d="M18 13.6V19.4M15.1 16.5H20.9"/>',
    ],
  },
  "user-node": {
    label: "Member Graph",
    paths: [
      '<circle cx="12" cy="7.5" r="3" fill="currentColor" stroke="none"/>',
      '<path d="M6.3 18.5C6.3 15.2 8.9 13.5 12 13.5C15.1 13.5 17.7 15.2 17.7 18.5"/>',
      '<circle cx="4.4" cy="6.6" r="1.5" fill="currentColor" stroke="none"/>',
      '<circle cx="19.6" cy="6.6" r="1.5" fill="currentColor" stroke="none"/>',
      '<path d="M6 7.1L9.4 8.1M18 7.1L14.6 8.1"/>',
    ],
  },
});
