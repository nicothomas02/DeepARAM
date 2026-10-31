// Shared by search and the near-miss page redirects (lib/page-slugs.ts).

/** Lower case, with accents, spaces and punctuation dropped: "Kai'Sa" and "kaisa" both give "kaisa". */
export const foldName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s'\u2019.&:!,_-]/g, "");
