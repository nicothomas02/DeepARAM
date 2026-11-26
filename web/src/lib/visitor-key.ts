// Rate limits count per visitor (src/middleware.ts). An IPv4 visitor is one address. An IPv6 subscriber is
// normally given a whole /64 network, so counting every IPv6 address apart would hand one visitor as many
// budgets as they care to use: IPv6 visitors are counted by their /64 instead.

const HEX_GROUP = /^[0-9a-f]{1,4}$/i;
const BYTE = /^(0|[1-9]\d{0,2})$/; // no leading zeros, as in the addresses Cloudflare sends

/** The four bytes of an IPv4 address written as text ("192.0.2.1"), or null when the text is not one. */
function ipv4Bytes(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((p) => BYTE.test(p))) return null;
  const bytes = parts.map(Number);
  return bytes.every((b) => b <= 255) ? bytes : null;
}

/** The eight 16-bit groups of an IPv6 address written as text, or null when the text is not one. */
function ipv6Groups(text: string): number[] | null {
  const halves = text.split("::"); // "::" stands for one or more groups of zeros and may appear once
  if (halves.length > 2) return null;
  const [head, tail = []] = halves.map((half) => (half === "" ? [] : half.split(":")));
  // The last 32 bits may be written as an IPv4 address ("::ffff:192.0.2.1"): two groups.
  const end = halves.length === 2 ? tail : head;
  let v4: number[] = [];
  if (end.length && end[end.length - 1].includes(".")) {
    const bytes = ipv4Bytes(end.pop()!);
    if (!bytes) return null;
    v4 = [(bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]];
  }
  if (![...head, ...tail].every((g) => HEX_GROUP.test(g))) return null;
  const given = head.length + tail.length + v4.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return null;
  const hex = (g: string) => parseInt(g, 16);
  return [...head.map(hex), ...new Array<number>(8 - given).fill(0), ...tail.map(hex), ...v4];
}

/**
 * The part of a rate-limit key that stands for one visitor, from the address their request came from.
 * An IPv4 address stays as it is. An IPv6 address becomes its /64 network, written one way however the
 * address was spelled: "2001:DB8:0:1::7" and "2001:0db8:0000:0001:ffff:ffff:ffff:ffff" both give
 * "2001:db8:0:1::/64". An IPv4 address carried inside IPv6 ("::ffff:192.0.2.1") counts as that IPv4 address.
 * Anything that is not an address ("unknown", an address with a zone like "%eth0") comes back unchanged.
 */
export function visitorKey(address: string): string {
  const groups = ipv6Groups(address);
  if (!groups) return address;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff)
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}
