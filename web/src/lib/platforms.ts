// League servers (platform routing values) and the regional group each one's accounts live in.
export const PLATFORMS = {
  na1: "americas", br1: "americas", la1: "americas", la2: "americas",
  euw1: "europe", eun1: "europe", tr1: "europe", ru: "europe",
  me1: "europe",
  kr: "asia", jp1: "asia",
  oc1: "sea", sg2: "sea", ph2: "sea", th2: "sea", tw2: "sea", vn2: "sea",
} as const;
export type Platform = keyof typeof PLATFORMS;
