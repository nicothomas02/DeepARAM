// Shared by search and the near-miss page redirects (lib/page-slugs.ts).

/** Lower case, with accents, spaces and punctuation dropped: "Kai'Sa" and "kaisa" both give "kaisa". */
export const foldName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s'\u2019.&:!,_-]/g, "");

// Korean players often search by a name's initial consonants (초성): "ㅋㅇㅌㄹ" for 케이틀린 (Caitlyn).
const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

/** Each Hangul syllable replaced by its initial consonant; other characters stay as they are. */
export const hangulInitials = (s: string) =>
  s.replace(/[가-힣]/g, (c) => INITIALS[Math.floor((c.charCodeAt(0) - 0xac00) / 588)]);

/** True when the query is only Hangul consonants (ㄱ-ㅎ), with or without spaces. */
export const isInitialsQuery = (q: string) => /^[ㄱ-ㅎ\s]+$/.test(q) && /[ㄱ-ㅎ]/.test(q);

/** Whether `text` contains `q`, where a query of bare Hangul consonants also matches names by their initials. */
export function textMatches(text: string, q: string) {
  if (text.includes(q)) return true;
  if (!isInitialsQuery(q)) return false;
  const want = q.replace(/\s/g, "");
  return hangulInitials(text).replace(/\s/g, "").includes(want);
}
