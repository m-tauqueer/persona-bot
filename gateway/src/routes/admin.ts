import type { FastifyInstance, FastifyReply } from "fastify";
import type postgres from "postgres";
import { createRequireOwner } from "../auth/owner.js";
import { callWorker } from "../clients/worker.js";
import type { GatewayConfig } from "../config.js";
import { deleteAudioBlobs } from "../lifecycle/blobs.js";
import { listPersonaAudioUrls } from "../lifecycle/wipe.js";
import { parseOptionalPersonaId } from "../personas.js";

type Sql = ReturnType<typeof postgres>;

async function sendWorker(reply: FastifyReply, response: Response) {
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { error: "worker_error" };
    }
  }
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (detail && typeof detail === "object") {
      body = detail;
    } else if (typeof detail === "string") {
      body = { error: detail };
    }
  }
  return reply.code(response.status).send(body);
}

export function workerPersonaPath(
  path: string,
  source: unknown,
  field: string,
): { ok: true; path: string } | { ok: false } {
  const pin = parseOptionalPersonaId(source, field);
  if (!pin.ok) {
    return { ok: false };
  }
  if (!pin.id) {
    return { ok: true, path };
  }
  const separator = path.includes("?") ? "&" : "?";
  return {
    ok: true,
    path: `${path}${separator}persona_id=${encodeURIComponent(pin.id)}`,
  };
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql },
): Promise<void> {
  const { config, sql } = deps;
  const requireOwner = createRequireOwner(config);

  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireOwner);

      admin.get("/persona", async (request, reply) => {
        const pinned = workerPersonaPath(
          "/internal/admin/persona",
          request.query,
          config.PERSONA_ID_QUERY,
        );
        if (!pinned.ok) {
          return reply.code(400).send({ error: "invalid query" });
        }
        const response = await callWorker(config, pinned.path);
        return sendWorker(reply, response);
      });

      admin.put("/persona", async (request, reply) => {
        const response = await callWorker(config, "/internal/admin/persona", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body ?? {}),
        });
        return sendWorker(reply, response);
      });

      admin.post("/persona/publish", async (request, reply) => {
        const response = await callWorker(
          config,
          "/internal/admin/persona/publish",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request.body ?? {}),
          },
        );
        return sendWorker(reply, response);
      });

      admin.post("/persona/destroy", async (request, reply) => {
        const pin = parseOptionalPersonaId(
          request.body,
          config.PERSONA_ID_QUERY,
        );
        if (!pin.ok || !pin.id) {
          return reply.code(400).send({ error: "invalid body" });
        }
        // Blobs live outside Postgres, so collect them while the rows that
        // name them are still here. The worker deletes those rows.
        const urls = await listPersonaAudioUrls(sql, pin.id);
        const response = await callWorker(
          config,
          "/internal/admin/persona/destroy",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request.body ?? {}),
          },
        );
        if (response.ok) {
          await deleteAudioBlobs(config, urls, request.log);
        }
        return sendWorker(reply, response);
      });

      admin.post("/teach", async (request, reply) => {
        const response = await callWorker(config, "/internal/admin/teach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body ?? {}),
        });
        return sendWorker(reply, response);
      });

      admin.get("/questions", async (request, reply) => {
        const pinned = workerPersonaPath(
          "/internal/admin/questions",
          request.query,
          config.PERSONA_ID_QUERY,
        );
        if (!pinned.ok) {
          return reply.code(400).send({ error: "invalid query" });
        }
        const response = await callWorker(config, pinned.path);
        return sendWorker(reply, response);
      });

      admin.post("/answer", async (request, reply) => {
        const response = await callWorker(config, "/internal/admin/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body ?? {}),
        });
        return sendWorker(reply, response);
      });

      admin.post("/ingest", async (request, reply) => {
        const pinned = workerPersonaPath(
          "/internal/admin/ingest",
          request.query,
          config.PERSONA_ID_QUERY,
        );
        if (!pinned.ok) {
          return reply.code(400).send({ error: "invalid query" });
        }
        const uploaded = await request.file();
        if (!uploaded) {
          return reply.code(400).send({ error: "file required" });
        }
        const buffer = await uploaded.toBuffer();
        if (buffer.byteLength > config.ADMIN_INGEST_MAX_BYTES) {
          return reply.code(413).send({ error: "file too large" });
        }
        const form = new FormData();
        form.append(
          "file",
          new Blob([buffer], { type: uploaded.mimetype }),
          uploaded.filename,
        );
        const response = await callWorker(config, pinned.path, {
          method: "POST",
          body: form,
        });
        return sendWorker(reply, response);
      });

      admin.post("/persona/clone", async (request, reply) => {
        const pinned = workerPersonaPath(
          "/internal/admin/persona/clone",
          request.query,
          config.PERSONA_ID_QUERY,
        );
        if (!pinned.ok) {
          return reply.code(400).send({ error: "invalid query" });
        }
        const uploaded = await request.file();
        if (!uploaded) {
          return reply.code(400).send({ error: "file required" });
        }
        const buffer = await uploaded.toBuffer();
        if (buffer.byteLength > config.ADMIN_FISH_CLONE_MAX_BYTES) {
          return reply.code(413).send({ error: "file too large" });
        }
        const form = new FormData();
        form.append(
          "file",
          new Blob([buffer], { type: uploaded.mimetype }),
          uploaded.filename,
        );
        const response = await callWorker(config, pinned.path, {
          method: "POST",
          body: form,
        });
        return sendWorker(reply, response);
      });

      admin.post("/subscribe", async (request, reply) => {
        const response = await callWorker(config, "/internal/admin/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body ?? {}),
        });
        return sendWorker(reply, response);
      });
    },
    { prefix: "/api/admin" },
  );
}
