import { defineIcons } from "./defineIcons";

export const BRAND_ICONS = defineIcons("Brand", {
  "logo-mark": {
    label: "Logo Mark",
    hero: true,
    paths: [
      '<rect x="2.5" y="2.5" width="7.2" height="7.2" rx="2.2" fill="currentColor" stroke="none"/>',
      '<circle cx="18" cy="6.1" r="3.6" fill="currentColor" stroke="none"/>',
      '<circle cx="6.1" cy="18" r="3.6" fill="currentColor" stroke="none"/>',
      '<rect x="14.3" y="14.3" width="7.2" height="7.2" rx="2.2" fill="currentColor" stroke="none"/>',
      '<path d="M9.7 6.1H14.4"/>',
      '<path d="M6.1 9.7V14.3"/>',
      '<path d="M9.9 9.9L14.1 14.1"/>',
    ],
  },
  "memory": {
    label: "Memory",
    hero: true,
    paths: [
      '<rect x="2.8" y="6" width="10.4" height="12" rx="3"/>',
      '<circle cx="20" cy="8" r="1.6" fill="currentColor" stroke="none"/>',
      '<circle cx="20" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
      '<circle cx="20" cy="16" r="1.6" fill="currentColor" stroke="none"/>',
      '<path d="M13.2 8H18.3"/>',
      '<path d="M13.2 12H18.3"/>',
      '<path d="M13.2 16H18.3"/>',
    ],
  },
  "graph": {
    label: "Connections",
    hero: true,
    paths: [
      '<circle cx="6" cy="6" r="2.6" fill="currentColor" stroke="none"/>',
      '<circle cx="18" cy="8" r="2.6" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="18" r="2.6" fill="currentColor" stroke="none"/>',
      '<path d="M8.5 6.9L15.5 8.1"/>',
      '<path d="M7.3 8.5L10.7 15.5"/>',
      '<path d="M16.7 10.6L13.3 15.4"/>',
    ],
  },
  "network": {
    label: "Network",
    hero: true,
    paths: [
      '<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="4" r="1.8" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="20" r="1.8" fill="currentColor" stroke="none"/>',
      '<circle cx="4.6" cy="8" r="1.8" fill="currentColor" stroke="none"/>',
      '<circle cx="19.4" cy="8" r="1.8" fill="currentColor" stroke="none"/>',
      '<circle cx="4.6" cy="16" r="1.8" fill="currentColor" stroke="none"/>',
      '<circle cx="19.4" cy="16" r="1.8" fill="currentColor" stroke="none"/>',
      '<path d="M12 5.8V9.5M12 14.5V18.2M9.8 10.8L6.6 9M14.2 10.8L17.4 9M9.8 13.2L6.6 15M14.2 13.2L17.4 15"/>',
    ],
  },
  "ai-spark": {
    label: "AI / Ask",
    hero: true,
    paths: [
      '<path d="M12 3.2C12 6.9 13.6 8.9 17.2 8.9C13.6 8.9 12 10.9 12 14.6C12 10.9 10.4 8.9 6.8 8.9C10.4 8.9 12 6.9 12 3.2Z" fill="currentColor" stroke="none"/>',
      '<path d="M18.4 13.4C18.4 15.2 19.2 16.1 21 16.1C19.2 16.1 18.4 17 18.4 18.9C18.4 17 17.6 16.1 15.8 16.1C17.6 16.1 18.4 15.2 18.4 13.4Z" fill="currentColor" stroke="none"/>',
      '<circle cx="6.4" cy="17.6" r="1.5" fill="currentColor" stroke="none"/>',
    ],
  },
  "embed": {
    label: "Embeddings",
    hero: true,
    paths: [
      '<circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="12" r="8.8" stroke-dasharray="0.1 4.6"/>',
      '<circle cx="5.8" cy="5.8" r="1.4" fill="currentColor" stroke="none"/>',
      '<circle cx="18.2" cy="18.2" r="1.4" fill="currentColor" stroke="none"/>',
    ],
  },
  "brain": {
    label: "Knowledge",
    hero: true,
    paths: [
      '<path d="M12 4.4C7.6 4.4 4 7.7 4 11.9C4 14.5 5.3 16.8 7.4 18.2V20.6H16.6V18.2C18.7 16.8 20 14.5 20 11.9C20 7.7 16.4 4.4 12 4.4Z"/>',
      '<circle cx="9.4" cy="10.6" r="1.35" fill="currentColor" stroke="none"/>',
      '<circle cx="14.6" cy="10.6" r="1.35" fill="currentColor" stroke="none"/>',
      '<circle cx="12" cy="14.2" r="1.35" fill="currentColor" stroke="none"/>',
      '<path d="M9.4 10.6H14.6M9.4 10.6L12 14.2M14.6 10.6L12 14.2"/>',
    ],
  },
  "idea": {
    label: "Idea",
    paths: [
      '<path d="M8 16.2C8 16.2 5.9 14.6 5.9 11.4C5.9 8 8.6 5.3 12 5.3C15.4 5.3 18.1 8 18.1 11.4C18.1 14.6 16 16.2 16 16.2H8Z"/>',
      '<path d="M9.5 19H14.5M10.2 21H13.8"/>',
      '<circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none"/>',
      '<path d="M12 16.2V12.8"/>',
    ],
  },
});
