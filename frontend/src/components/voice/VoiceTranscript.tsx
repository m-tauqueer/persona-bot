import { useEffect, useRef } from "react";
import {
  labelForTranscriptRole,
  type TranscriptLine,
} from "../../lib/voiceTranscript";
import { PixelAvatar } from "./PixelAvatar";

export type VoiceTranscriptAvatar = {
  userSeed: string;
  personaSeed: string;
  size: number;
  gridSize: number;
  hueSpread: number;
  animated: boolean;
};

function rowClass(user: boolean, interim: boolean): string {
  const side = user ? "voice-sit__row--user" : "voice-sit__row--assistant";
  if (interim) {
    return `voice-sit__row ${side} voice-sit__row--interim`;
  }
  return `voice-sit__row ${side}`;
}

export function VoiceTranscript({
  title,
  empty,
  lines,
  userRole,
  assistantRole,
  userLabel,
  assistantLabel,
  avatar,
}: {
  title: string;
  empty: string;
  lines: readonly TranscriptLine[];
  userRole: string;
  assistantRole: string;
  userLabel: string;
  assistantLabel: string;
  avatar: VoiceTranscriptAvatar;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const idle = lines.length === 0;

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [lines]);

  return (
    <aside
      className="voice-sit__transcript"
      aria-label={title}
      style={{ ["--voice-transcript-avatar" as string]: `${avatar.size}px` }}
    >
      <h2 className="voice-sit__transcript-title">{title}</h2>
      <div
        className={
          idle
            ? "voice-sit__transcript-list voice-sit__transcript-list--empty"
            : "voice-sit__transcript-list"
        }
        ref={listRef}
      >
        {idle ? (
          <p className="voice-sit__transcript-empty">{empty}</p>
        ) : (
          lines.map((line) => {
            const user = line.role === userRole;
            const roleLabel = labelForTranscriptRole(
              line.role,
              userRole,
              assistantRole,
              userLabel,
              assistantLabel,
            );
            return (
              <div key={line.id} className={rowClass(user, line.interim)} aria-label={roleLabel}>
                <PixelAvatar
                  seed={user ? avatar.userSeed : avatar.personaSeed}
                  size={avatar.size}
                  gridSize={avatar.gridSize}
                  hueSpread={avatar.hueSpread}
                  animated={avatar.animated}
                />
                <p
                  className={
                    user
                      ? "voice-sit__bubble voice-sit__bubble--user"
                      : "voice-sit__bubble voice-sit__bubble--assistant"
                  }
                >
                  {line.text}
                </p>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
