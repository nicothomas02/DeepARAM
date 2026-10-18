import { afterEach, describe, expect, it, vi } from "vitest";

// lib/report.ts runs in the browser; stand in a window, location, navigator and sendBeacon.
const sent: string[] = [];
vi.stubGlobal("window", {});
vi.stubGlobal("location", { pathname: "/", search: "" });
vi.stubGlobal("navigator", { userAgent: "test", sendBeacon: (_: string, b: Blob) => (b.text().then((t) => sent.push(JSON.parse(t).message)), true) });

describe("browser error reports", () => {
  afterEach(() => (sent.length = 0));

  it("skips harmless browser noise but sends real errors", async () => {
    const { reportError } = await import("@/lib/report");
    reportError("ResizeObserver loop completed with undelivered notifications.");
    reportError("Skipping view transition because document visibility state has become hidden.");
    reportError("Script error.");
    reportError("TypeError: x is undefined");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(["TypeError: x is undefined"]);
  });
});
