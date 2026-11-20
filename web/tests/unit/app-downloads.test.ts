import { describe, expect, it } from "vitest";
import { APP_DOWNLOADS, guessOs, isAppOs } from "@/lib/app-downloads";

describe("desktop app downloads", () => {
  it("knows only Windows and Mac", () => {
    expect(isAppOs("windows")).toBe(true);
    expect(isAppOs("mac")).toBe(true);
    expect(isAppOs("linux")).toBe(false);
    expect(isAppOs("toString")).toBe(false);
  });

  it("uses the fixed names release.yml attaches", () => {
    expect(APP_DOWNLOADS.windows.file).toBe("DeepARAM-Windows-Setup.exe");
    expect(APP_DOWNLOADS.mac.file).toBe("DeepARAM-Mac.dmg");
  });

  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", "windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", "mac"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", null],
    ["Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36", null],
  ])("suggests the visitor's own system first", (ua, os) => expect(guessOs(ua)).toBe(os));
});
