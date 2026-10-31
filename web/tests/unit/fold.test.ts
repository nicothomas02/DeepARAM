import { describe, expect, it } from "vitest";
import { foldName } from "@/lib/fold";

describe("search folding", () => {
  it("drops case, accents, spaces and punctuation", () => {
    expect(foldName("Kai'Sa")).toBe("kaisa");
    expect(foldName("Dr. Mundo")).toBe("drmundo");
    expect(foldName("Nunu & Willump")).toBe("nunuwillump");
    expect(foldName("Kog’Maw")).toBe("kogmaw");
    expect(foldName("Pokémon")).toBe("pokemon");
  });

  it("keeps letters of other scripts", () => {
    expect(foldName("阿狸")).toBe("阿狸");
  });
});
