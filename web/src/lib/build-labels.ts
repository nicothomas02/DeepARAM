/** Build style names as the card's build tabs show them (data/estimates/build_archetypes.json styles). */
export const ARCH_LABEL: Record<string, string> = { crit: "Crit", onhit: "On-hit", ap: "AP", lethality: "Lethality", fighter: "Fighter", tank: "Tank", enchanter: "Enchanter" };

/** A build tab's label: "Niche: Enchanter" for a niche build, else the style's name. */
export const buildLabel = (style: string, niche?: boolean) => (niche ? `Niche: ${ARCH_LABEL[style] ?? style}` : (ARCH_LABEL[style] ?? style));
