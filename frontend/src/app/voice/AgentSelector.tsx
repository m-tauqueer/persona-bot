import { Card } from "../../components/ui/Card";
import { PixelAvatar } from "../../components/voice/PixelAvatar";
import type { PublishedPersona } from "../../lib/publishedPersonas";
import type { VoiceClientConfig } from "../../lib/voiceConfig";

export function AgentSelector({
  directory,
  title,
  empty,
  help,
  config,
  pickedId = null,
  onPick,
}: {
  directory: PublishedPersona[];
  title: string;
  empty: string;
  help: string;
  config: VoiceClientConfig;
  pickedId?: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <Card variant="paper" className="voice-pick__card">
      <h1 className="voice-pick__title">{title}</h1>
      <p className="voice-pick__help">{help}</p>
      {directory.length === 0 ? (
        <p className="voice-pick__empty">{empty}</p>
      ) : (
        <ul className="voice-pick__row">
          {directory.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="voice-pick__agent"
                aria-pressed={pickedId === row.id}
                onClick={() => onPick(row.id)}
                aria-label={`${row.display_name} @${row.handle}`}
              >
                <PixelAvatar
                  seed={row.handle}
                  size={config.avatarSize}
                  gridSize={config.avatarGrid}
                  hueSpread={config.avatarHueSpread}
                  animated={config.avatarAnimated}
                />
                <span className="voice-pick__name">{row.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}