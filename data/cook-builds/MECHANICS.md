# Mayhem mechanics notes

Rules and player knowledge for designing Chef Specials. Sources: the League wiki (full augment text in `data/wiki/mayhem_augments.json`, also shown by
`data/checks/champion_pool.py`), the game's own augment
text, and answers from Nico, the site owner (marked "Nico"). Some of Nico's notes come from his own games
rather than official text; they are marked "experience". For official definitions (for example, what counts as
damage over time), check the League wiki first.

## Augments

- **Archmage:** each cast takes 30% of the *cast* ability's *base* cooldown off another random ability. It can
  land on a ready ability (wasted) or on R, never on summoner spells. Haste doesn't shrink the refund.
- **Overloaded:** resets the chosen ability whenever another ability is cast, even on a miss. Never rolls on an
  ultimate (Nico).
- **Ethereal Weapon:** ability on-hits trigger Mystic Punch (Nico).
- **Skilled Sniper:** Ziggs' Satchel Charge gets the full 80% refund (Nico).
- **Sound Barrier:** fires only when you shield an ally, not yourself (Mayhem text).
- **Echo Cast:** the clone fires slightly in front of the champion. On Twisted Fate this makes the two card fans
  very hard to dodge. Recoil makes the echo even harder to read, though Recoil alone isn't as strong (Nico,
  experience).
- **Vulnerability:**
  - These all count as damage over time (Nico):
    - Gangplank's passive and R
    - Corki's W and E
    - Garen's E
    - Lucian's R
  - Vulnerability stacks with Jeweled Gauntlet and Jeweled Bracelet for 4x or 8x crit damage.
  - "Damage over time" is loose in this mode, so use the wiki's definition.
- **Snowball augments:**
  - Biggest Snowball Ever doesn't buff Nunu's W. He takes it as reliable damage, because his kit is otherwise
    unreliable in this mode.
  - Zoe's copied snowball gets every snowball modifier.
  - Snowball augments stack hard: Biggest Snowball Ever + Pinball deals extreme damage (Nico).
- **Draw Your Sword:**
  - Corki and Ezreal rely little on attacks, so their kits get the stats for little tradeoff.
  - Graves's melee attack is one instance, so all his pellets land (Nico).
- **Scoped Weapons (all tiers):** melee champions seem to gain more range than ranged ones. That's why
  attack-reliant melees like Nasus and Tryndamere value it (Nico, experience).
- **One Hit Wonder on Jayce:** mostly helps ranged Q. His combo empowers Q through Acceleration Gate, so the lost
  haste matters less. It may also interact with Purist - Caster (Nico, experience).
- **BEES!!! on Varus:** Bees apply on-hit, so they apply W Blight. That is strong against tanks. They may also
  pop the stacks right away; not confirmed (Nico).
- **Shrink Engine on Ashe:** easy to stack, because Ashe gets takedowns from long range at low risk (Nico).
- **Goliath and Mad Scientist on Tahm Kench:** his Q range grows with size, so size augments are worth more
  on him (Nico).
- **Recoil:** always launches you away from where you cast, so it's a very safe poke tool for artillery mages
  (Xerath, Ziggs, Veigar, Vex). On Akali it gets her out of her own circle faster, which turns on her passive (Nico).
- **Homeguard:** works anywhere on the map in Mayhem. Back-line poke mages rarely take damage, so the 100% Move
  Speed is nearly always on (Nico).
- **From Downtown:** a quest. Hit champions with abilities from 600+ units away 15 times. Afterwards, each such
  hit drops a meteor that grows with distance (wiki). **Pressure Cooker:** a quest that ends in a damage-over-time
  aura around you, stacking without limit (Nico; not on the wiki yet).
- **Mad Scientist:** re-rolls large or tiny each time you respawn (wiki). Sion's passive is not a revive. He likes
  these augments for the Health and because he dies early and often, which also stacks his W passive (Nico).
  Dive Bomber probably only fires on the first death (Nico, not sure).
- **Blade Waltz:** a summoner spell that blinks to enemies up to 8 times, untargetable, applying on-hit at 50%
  (wiki). Garen's E keeps spinning during it, so full crit/attack speed Garen is invulnerable while it
  guarantees hits. Q probably doesn't carry over (Nico, not sure).
- **Echo Cast:** Kennen, Neeko and Amumu take it on R, the core of their kits. Blitzcrank's R echo gives a second
  silence and suits AP Blitz (Nico).
- **Draw Your Sword:** Caitlyn has E and R for a melee style, and Jhin's Move Speed and execute turn him into an
  assassin with escapes. Both get huge stats from the range they lose (Nico).
- **Biggest Snowball Ever:** suits utility/peel champions and champions without strong synergies. Its knock-up
  counts as an immobilize (Nico, believes).
- **Ashe:** her crits deal no bonus damage (passive), so crit damage augments like Big Shot are bad on her.

## Items

- **Moonstone Renewer:** its chained heal or shield triggers ally augments (Sound Barrier, Sonic Boom, Spirit
  Bomb) (Nico).
- **Hextech Rocketbelt:** its dash triggers Earthwake, Shadow Runner, Swift and Safe and Outlaw's Grit, but not
  Dashing (Nico).
- **Actualizer and Overflow:** they stack to 4x mana costs, which feeds Blue Barrier and Rod of Ages (Nico).
- **Liandry's Torment:** its burn can crit through Vulnerability (Nico).
- **Blade of the Ruined King:** current-Health on-hit damage, so any champion with attack speed does real
  damage (Nico).

## Data limits

- The site has no real augment-pair data. "Augment combinations" are model estimates (product of pick rates),
  so they can't show which augments are actually taken together.
