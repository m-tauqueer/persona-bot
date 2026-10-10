import { describe, expect, it } from "vitest";
import { workerPersonaPath } from "./routes/admin.js";

describe("admin persona pin forwarding", () => {
  it("leaves the worker path unchanged when no pin is present", () => {
    expect(
      workerPersonaPath("/internal/admin/persona", {}, "persona_id"),
    ).toEqual({
      ok: true,
      path: "/internal/admin/persona",
    });
  });

  it("appends the worker persona_id query from the configured field", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    expect(
      workerPersonaPath(
        "/internal/admin/questions",
        { persona_id: id },
        "persona_id",
      ),
    ).toEqual({
      ok: true,
      path: `/internal/admin/questions?persona_id=${id}`,
    });
  });

  it("rejects a pin that is not a uuid", () => {
    expect(
      workerPersonaPath(
        "/internal/admin/ingest",
        { persona_id: "nova" },
        "persona_id",
      ),
    ).toEqual({ ok: false });
  });
});
