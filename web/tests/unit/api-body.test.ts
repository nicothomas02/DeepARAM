import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { readBody } from "@/lib/api-body";
import { body } from "@/lib/account-route";

// Both body readers refuse anything that isn't a JSON object before a route looks at it.
const post = (text: string) => new NextRequest("https://deeparam.com/api/x", { method: "POST", body: text });

describe("readBody (My Stats routes)", () => {
  it("returns the object for a JSON object", async () => {
    expect(await readBody(post('{"action":"status"}'), 100)).toEqual({ action: "status" });
  });

  it("answers 413 over the cap, before parsing", async () => {
    const res = await readBody(post("x".repeat(101)), 100);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(413);
  });

  it.each(["not json", "[1,2]", '"text"', "5", "null", ""])("answers 400 to %j", async (text) => {
    const res = await readBody(post(text), 100);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    expect(await (res as Response).json()).toEqual({ error: "Bad request" });
  });
});

describe("body (account routes)", () => {
  it("treats an empty body as an empty object", async () => {
    expect(await body(post(""))).toEqual({});
  });

  it.each(["[1]", '"text"', "7", "null", "{bad"])("rejects %j as a bad request", async (text) => {
    await expect(body(post(text))).rejects.toMatchObject({ message: "Bad request", status: 400 });
  });

  it("rejects an oversized body with 413", async () => {
    await expect(body(post("{" + " ".repeat(16_001) + "}"))).rejects.toMatchObject({ status: 413 });
  });
});
