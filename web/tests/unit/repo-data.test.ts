import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/repo-data";

// The CSV reader behind every data loader (lib/repo-data.ts). The files come from the Python builders, which
// can write them with a byte-order mark or leave one empty between runs.
describe("parseCsv", () => {
  it("reads rows by header, quoted fields and Windows line ends", () => {
    expect(parseCsv('patch,name,augs\r\n16.20,Brand,"1133,1045"\r\n16.20,"Kog""Maw",\r\n')).toEqual([
      { patch: "16.20", name: "Brand", augs: "1133,1045" },
      { patch: "16.20", name: 'Kog"Maw', augs: "" },
    ]);
  });

  it("fills in missing fields and skips blank lines", () => {
    expect(parseCsv("a,b,c\n1,2\n\n3,4,5\n")).toEqual([
      { a: "1", b: "2", c: "" },
      { a: "3", b: "4", c: "5" },
    ]);
  });

  it("gives no rows for an empty file or a header alone", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n")).toEqual([]);
    expect(parseCsv("patch,days\n")).toEqual([]);
  });

  it("ignores a byte-order mark, so the first column keeps its name", () => {
    const [row] = parseCsv("﻿patch,days\n16.20,10\n");
    expect(row.patch).toBe("16.20");
    expect(Object.keys(row)).toEqual(["patch", "days"]);
  });
});
