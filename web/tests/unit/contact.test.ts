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

  it("refuses an address that would smuggle extra recipients into the owner's reply link", () => {
    // The inbox replies through a mailto: link; a ? or & in the address would add headers to it.
    for (const bad of ["me@example.com?bcc=them@example.com", "me@example.com&cc=x", "me@exa%40mple.com", "me@example.com/x", "me@example.com,you@example.com"])
      expect(() => cleanMessage({ message: "Found a bug", replyTo: bad })).toThrow("That email address doesn't look right.");
    expect(cleanMessage({ message: "Found a bug", replyTo: "first.last+tag@sub.example.co.uk" }).replyTo).toBe("first.last+tag@sub.example.co.uk");
  });

  it("keeps only a page path from this site", () => {
    expect(cleanMessage({ message: "Hello there", page: "https://evil.example/" }).page).toBeNull();
  });
});
