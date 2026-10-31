// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { setParams } from "@/lib/url-state";

describe("view in the address", () => {
  it("changes filters in place, without a Back step", () => {
    history.replaceState(null, "", "/tier-list");
    const before = history.length;
    setParams({ sort: "wr.desc" });
    expect(location.search).toBe("?sort=wr.desc");
    expect(history.length).toBe(before);
  });

  it("adds a Back step when switching tabs, and none when the address doesn't change", () => {
    history.replaceState(null, "", "/tier-list");
    const before = history.length;
    setParams({ tab: "augments" }, { push: true });
    expect(location.search).toBe("?tab=augments");
    expect(history.length).toBe(before + 1);
    setParams({ tab: "augments" }, { push: true });
    expect(history.length).toBe(before + 1);
  });
});
