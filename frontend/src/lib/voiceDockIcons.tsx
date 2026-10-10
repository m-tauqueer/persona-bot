import {
  ArrowLeft,
  Close,
  Mic,
  PhoneHangup,
} from "../components/icons";
import { requiredVite } from "./env";

const VOICE_DOCK_ICONS = {
  ArrowLeft,
  Close,
  Mic,
  PhoneHangup,
} as const;

export type VoiceDockIconName = keyof typeof VOICE_DOCK_ICONS;

export const VOICE_DOCK_ICON_NAMES = Object.keys(
  VOICE_DOCK_ICONS,
) as VoiceDockIconName[];

export function requiredVoiceDockIcon(
  name: keyof ImportMetaEnv,
): VoiceDockIconName {
  return requiredViteOneOfIcon(name);
}

function requiredViteOneOfIcon(name: keyof ImportMetaEnv): VoiceDockIconName {
  const value = requiredVite(name);
  if (value in VOICE_DOCK_ICONS) {
    return value as VoiceDockIconName;
  }
  throw new Error(
    `${name} must be one of: ${VOICE_DOCK_ICON_NAMES.join(", ")}`,
  );
}

export function VoiceDockIcon({
  name,
  size,
}: {
  name: VoiceDockIconName;
  size: number;
}) {
  const Icon = VOICE_DOCK_ICONS[name];
  return <Icon size={size} />;
}
