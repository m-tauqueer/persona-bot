/**
 * Live Fish TTS websocket check. Skips when FISH_API_KEY is unset.
 */
import { loadGatewayConfig } from "../config.js";
import { FishLiveError, FishLiveTts, fishAudioBytes } from "../fish/live.js";

async function main(): Promise<number> {
  const config = loadGatewayConfig();
  if (!config.FISH_API_KEY) {
    console.log("SKIP: FISH_API_KEY is not set");
    return 0;
  }
  console.log(
    `fish_live_url=${config.FISH_API_BASE_URL}${config.FISH_TTS_LIVE_PATH}`,
  );
  console.log(`fish_tts_model=${config.FISH_TTS_MODEL}`);
  let live: FishLiveTts | null = null;
  try {
    live = await FishLiveTts.connect(config);
    const audio = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for Fish audio"));
      }, config.FISH_TTS_TIMEOUT_MS);
      const off = live?.onMessage((message) => {
        const event = typeof message.event === "string" ? message.event : "";
        if (event === config.FISH_WS_EVENT_AUDIO) {
          const bytes = fishAudioBytes(message);
          if (bytes && bytes.length > 0) {
            clearTimeout(timer);
            off?.();
            resolve(bytes.length);
          }
          return;
        }
        if (event === config.FISH_WS_EVENT_FINISH) {
          const reason =
            typeof message.reason === "string" ? message.reason : "";
          if (reason === config.FISH_WS_FINISH_REASON_ERROR) {
            clearTimeout(timer);
            off?.();
            reject(new Error("Fish finish reason is error"));
          }
        }
      });
      live?.start(config.FISH_PROBE_REFERENCE_ID);
      live?.sendText(config.FISH_PROBE_TEXT);
      live?.flush();
      live?.stopStream();
    });
    console.log(`fish_audio_bytes=${audio}`);
    console.log("fish_live=ok");
    return 0;
  } catch (error) {
    if (error instanceof FishLiveError) {
      console.error(`FAIL: ${error.code} ${error.message}`);
      return 1;
    }
    console.error(
      `FAIL: ${error instanceof Error ? error.message : "fish live failed"}`,
    );
    return 1;
  } finally {
    live?.close();
  }
}

void main().then((code) => {
  process.exit(code);
});
