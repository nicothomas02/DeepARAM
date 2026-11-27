"use client";

import DeepScore from "./DeepScore";
import { useOwnerPoints } from "@/lib/owner-view";

// An augment page's DeepScore badge. Its hover's win-rate-point lead is for the signed-in owner only (lib/owner-view.ts);
// everyone else gets the badge without it.
export default function AugmentDeepScore({ id, ...rest }: { id: number } & Omit<Parameters<typeof DeepScore>[0], "edge">) {
  const owner = useOwnerPoints("augments", id);
  return <DeepScore {...rest} edge={owner?.edge ?? undefined} />;
}
