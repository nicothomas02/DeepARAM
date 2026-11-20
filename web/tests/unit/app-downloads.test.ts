import { describe, expect, it } from "vitest";
import { APP_DOWNLOADS, isAppOs, onWindows } from "@/lib/app-downloads";

describe("desktop app downloads", () => {
  it("offers only Windows", () => {
    expect(isAppOs("windows")).toBe(true);
    expect(isAppOs("mac")).toBe(false);
    expect(isAppOs("linux")).toBe(false);
    expect(isAppOs("toString")).toBe(false);
  });

  it("uses the fixed name release.yml attaches", () => expect(APP_DOWNLOADS.windows.file).toBe("DeepARAM-Windows-Setup.exe"));

  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", false],
    ["Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36", false],
  ])("spots Windows browsers", (ua, win) => expect(onWindows(ua)).toBe(win));
});
