import { describe, expect, it } from "vitest";
import { readJson, writeJson } from "./storage";

describe("storage helpers", () => {
  it("returns fallback when key is missing", () => {
    const value = readJson("missing-key", { ok: true });
    expect(value).toEqual({ ok: true });
  });

  it("round-trips JSON values", () => {
    writeJson("profile-key", {
      name: "Local Dev",
      baseUrl: "http://127.0.0.1:8000"
    });
    const value = readJson("profile-key", null);
    expect(value).toEqual({
      name: "Local Dev",
      baseUrl: "http://127.0.0.1:8000"
    });
  });

  it("returns fallback for invalid JSON payloads", () => {
    localStorage.setItem("invalid-json", "{broken");
    const value = readJson("invalid-json", ["fallback"]);
    expect(value).toEqual(["fallback"]);
  });
});

