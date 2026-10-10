import type { FastifyBaseLogger } from "fastify";
import { createBlobService } from "../clients.js";
import type { GatewayConfig } from "../config.js";
import { voiceAudioPersistEnabled, voiceAudioReady } from "../config.js";

export function blobNameFromUrl(
  blobUrl: string,
  container: string,
): string | null {
  try {
    const name = decodeURIComponent(
      new URL(blobUrl).pathname
        .split(`/${container}/`)
        .slice(1)
        .join(`/${container}/`),
    );
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export async function deleteAudioBlobs(
  config: GatewayConfig,
  urls: string[],
  log: FastifyBaseLogger,
): Promise<void> {
  if (urls.length === 0 || !voiceAudioPersistEnabled(config)) {
    return;
  }
  const ready = voiceAudioReady(config);
  if (ready) {
    log.warn({ reason: ready }, "audio blob delete skipped");
    return;
  }
  const containerName = config.AZURE_BLOB_CONTAINER;
  if (!containerName) {
    return;
  }
  try {
    const container =
      createBlobService(config).getContainerClient(containerName);
    for (const url of urls) {
      const name = blobNameFromUrl(url, containerName);
      if (!name) {
        continue;
      }
      try {
        await container.getBlockBlobClient(name).deleteIfExists();
      } catch (error) {
        log.warn({ err: error, name }, "audio blob delete failed");
      }
    }
  } catch (error) {
    log.warn({ err: error }, "audio blob store unavailable");
  }
}
