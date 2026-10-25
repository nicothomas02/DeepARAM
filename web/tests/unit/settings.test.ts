// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_EVENT, SETTINGS_KEY, SETTINGS_SCRIPT } from "@/lib/settings";

describe("settings", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.motion;
    delete document.documentElement.dataset.view;
  });

  it("starts from the defaults and survives corrupted storage", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_KEY, "{oops");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a change into what's saved, applies it and tells listeners", () => {
    const seen = vi.fn();
    window.addEventListener(SETTINGS_EVENT, seen);
    saveSettings({ sound: false });
    saveSettings({ motion: "reduce" });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, sound: false, motion: "reduce" });
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(seen).toHaveBeenCalledTimes(2);
    saveSettings({ motion: "system" });
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  it("before-paint script applies reduced motion and never throws", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ motion: "reduce" }));
    new Function(SETTINGS_SCRIPT)();
    expect(document.documentElement.dataset.motion).toBe("reduce");
    localStorage.setItem(SETTINGS_KEY, "{oops");
    expect(() => new Function(SETTINGS_SCRIPT)()).not.toThrow();
  });

  it("shows the simple view by default and the detailed view when picked", () => {
    new Function(SETTINGS_SCRIPT)();
    expect(document.documentElement.dataset.view).toBe("simple");
    saveSettings({ view: "detailed" });
    expect(document.documentElement.dataset.view).toBe("detailed");
    delete document.documentElement.dataset.view;
    new Function(SETTINGS_SCRIPT)();
    expect(document.documentElement.dataset.view).toBe("detailed");
  });
});
