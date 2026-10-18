import { describe, expect, it } from "vitest";
import { cleanMessage } from "@/lib/contact";

// Contact us: what the footer's message box may send (lib/contact.ts).
describe("cleanMessage", () => {
  it("accepts a message, with or without an email for a reply", () => {
    expect(cleanMessage({ message: "  The tier list is great!  ", page: "/tier-list" })).toEqual({
      message: "The tier list is great!",
      replyTo: null,
      page: "/tier-list",
    });
    expect(cleanMessage({ message: "Found a bug on Jinx", replyTo: " me@example.com " }).replyTo).toBe("me@example.com");
  });

  it.each([
    [{ message: "hey" }, "Write a little more first."],
    [{ message: "x".repeat(2001) }, "That's too long. Keep it under 2,000 characters."],
    [{ message: "Found a bug", replyTo: "not an email" }, "That email address doesn't look right."],
    [{ message: 42 }, "Write a little more first."],
  ])("refuses %j", (body, error) => {
    expect(() => cleanMessage(body as Record<string, unknown>)).toThrow(error);
  });

  it("keeps only a page path from this site", () => {
    expect(cleanMessage({ message: "Hello there", page: "https://evil.example/" }).page).toBeNull();
  });
});
