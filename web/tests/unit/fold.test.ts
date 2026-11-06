import { describe, expect, it } from "vitest";
import { foldName, hangulInitials, textMatches } from "@/lib/fold";

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

  it("matches Korean names by their initial consonants", () => {
    expect(hangulInitials("케이틀린")).toBe("ㅋㅇㅌㄹ");
    expect(textMatches("케이틀린 caitlyn", "ㅋㅇㅌㄹ")).toBe(true);
    expect(textMatches("케이틀린", "ㅋㅇ")).toBe(true);
    expect(textMatches("케이틀린", "ㅇㅌ ㄹ")).toBe(true);
    expect(textMatches("아리", "ㅋㅇㅌㄹ")).toBe(false);
    expect(textMatches("caitlyn", "cait")).toBe(true);
  });
});
