import "server-only";
import { serverEnv } from "./env";
import { cleanContent, type Content } from "./content";
import bundled from "@/content/site.json";

// Backs the site editor (/account/edit), open to the owner's account only (OWNER_EMAIL, lib/accounts.ts). Secret:
//   GITHUB_TOKEN    fine-grained token with Contents read/write on nicothomas02/DeepARAM only
// A save commits src/content/site.json to main; Workers Builds then redeploys the site.

const REPO = "nicothomas02/DeepARAM";
const FILE = "web/src/content/site.json";
const BRANCH = "main";

export class AdminError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function github(path: string, init?: RequestInit) {
  const token = serverEnv("GITHUB_TOKEN");
  if (!token) throw new AdminError("Saving isn't set up yet: GITHUB_TOKEN is missing.", 503);
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "deeparam-admin",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
}

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const fromBase64 = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

/** The text as it is on main now (it can be newer than this deploy), plus the file version for saving. */
export async function loadContent(): Promise<{ content: Content; sha: string | null }> {
  if (!serverEnv("GITHUB_TOKEN")) return { content: cleanContent(bundled), sha: null };
  const res = await github(`contents/${FILE}?ref=${BRANCH}`);
  if (!res.ok) throw new AdminError(`GitHub returned ${res.status} reading the site text.`, 502);
  const file = (await res.json()) as { content: string; sha: string };
  return { content: cleanContent(JSON.parse(fromBase64(file.content))), sha: file.sha };
}

export async function saveContent(input: unknown, sha: string | null): Promise<string> {
  if (!sha) throw new AdminError("Saving isn't set up yet: GITHUB_TOKEN is missing.", 503);
  const body = JSON.stringify(cleanContent(input), null, 2) + "\n";
  const res = await github(`contents/${FILE}`, {
    method: "PUT",
    body: JSON.stringify({ message: "Edit site text from the site editor", content: toBase64(body), sha, branch: BRANCH }),
  });
  if (res.status === 409 || res.status === 422) throw new AdminError("The text changed since you opened the editor. Reload to get the latest, then save again.", 409);
  if (!res.ok) throw new AdminError(`GitHub returned ${res.status} saving the site text.`, 502);
  const out = (await res.json()) as { content: { sha: string } };
  return out.content.sha;
}
