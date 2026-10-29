import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMayhemQueue, MAYHEM_QUEUE_IDS } from "@/lib/mayhem-queues";

// The site's Mayhem queue list (lib/mayhem-queues.ts) must match what the importer filters on:
// importer/mayhem_import.py mayhem_queue_ids() reads data/constants/queues.json and always adds 2400 and 2450.
describe("MAYHEM_QUEUE_IDS", () => {
  it("lists every Mayhem queue in Riot's queue file, plus the importer's 2400 and 2450", () => {
    const queues = JSON.parse(readFileSync("../data/constants/queues.json", "utf8")) as { queueId: number; description?: string | null }[];
    const fromRiot = queues.filter((q) => (q.description ?? "").toLowerCase().includes("mayhem")).map((q) => q.queueId);
    expect(fromRiot.length).toBeGreaterThan(0);
    expect([...MAYHEM_QUEUE_IDS].sort()).toEqual([...new Set([2400, 2450, ...fromRiot])].sort());
  });

  it("recognises a queue id as a number or a string, and nothing else", () => {
    expect(isMayhemQueue(2400)).toBe(true);
    expect(isMayhemQueue("2450")).toBe(true);
    expect(isMayhemQueue(450)).toBe(false); // regular ARAM
    expect(isMayhemQueue(undefined)).toBe(false);
    expect(isMayhemQueue("mayhem")).toBe(false);
  });
});
