import { describe, expect, it } from "vitest";
import { patchName, patchVersion } from "@/lib/patch-name";

describe("patch numbers", () => {
  it("shows Riot's patch number for a client version", () => {
    expect(patchName("16.20")).toBe("26.20");
    expect(patchName("16.1")).toBe("26.1");
    expect(patchName("15.24")).toBe("25.24");
  });
  it("leaves public numbers as they are, without a leading zero", () => {
    expect(patchName("26.21")).toBe("26.21");
    expect(patchName("26.01")).toBe("26.1");
  });
  it("handles missing values and odd strings", () => {
    expect(patchName(null)).toBe("");
    expect(patchName("PBE")).toBe("PBE");
  });
  it("maps a patch page URL back to the client version", () => {
    expect(patchVersion("26.20")).toBe("16.20");
    expect(patchVersion("25.21")).toBe("15.21");
    expect(patchVersion("16.20")).toBe("16.20");
  });
});
