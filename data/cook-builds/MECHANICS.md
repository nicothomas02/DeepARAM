# Mayhem mechanics notes

Rules and player knowledge for designing Chef Specials. Sources: the League wiki (full augment text in `data/wiki/mayhem_augments.json`, also shown by
`data/checks/champion_pool.py`), the game's own augment
text, and answers from Nico, the site owner (marked "Nico"). Some of Nico's notes come from his own games
rather than official text; they are marked "experience". For official definitions (for example, what counts as
damage over time), check the League wiki first.

Ability tags: `data/wiki/ability_tags.json` (built by `data/wiki/ability_tags.py`) tags every ability with the
League wiki's own game terms, which follow the game's internal coding: dash vs blink, channel, airborne,
immobilize (stun, root, snare, suppression, sleep), forced action (charm, taunt, fear), on-hit, attack reset and
more. `data/checks/champion_pool.py` prints them. Match augment triggers to these tags, not to tooltip wording
(Nico 2026-11-20). Tags come from the ability's description, so a mention like "can't be polymorphed" can add a
stray tag; check the wiki text when a tag decides the build.

## Augments

- **Archmage:** each cast takes 30% of the *cast* ability's *base* cooldown off another random ability. It can
  land on a ready ability (wasted) or on R, never on summoner spells. Haste doesn't shrink the refund.
- **Overloaded:** resets the chosen ability whenever another ability is cast, even on a miss. Never rolls on an
  ultimate (Nico).
- **Ethereal Weapon:** ability on-hits trigger Mystic Punch (Nico), and on-hit augments too (Firebrand, Light 'Em Up,
  Tickle Monster...), which opens a lot of combinations (Nico).
- **Mystic Punch:** its game value `MinCDR = 0.5` is not a half-cooldown cap: Hecarim with Ethereal Weapon + Mystic
  Punch casts Q nonstop (Nico). The Simulator reads it as a 0.5-second floor on what's left of a cooldown.
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
- **AP Ashe:** good only with Archmage (Nico). Her top augments in our data back this up: Shrink Engine,
  Recursion, Archmage, Eureka and Purist - Caster are all in her top 8, and Shadowflame and Rabadon's beat her
  average full build.
- **Archmage Zilean:** loops all his abilities into near-permanent stun/slow with his revive almost always up.
  One Hit Wonder combines with it (Nico). Data agrees: Archmage is his #1 augment, One Hit Wonder is S.
- **Dashing:** best where the dash is a damage ability or the champion has several dashes (Aurora, Fizz, Riven).
  Bad on Gwen (E uptime already near constant), Diana (already resets on marked targets), Zoe (R cooldown tiny at
  max rank) and Aatrox (Nico).
- **Mystic Punch:** bad on champions that only auto now and then for a passive and mainly cast (Aatrox, Maokai,
  Swain, Akali) (Nico).
- **Ultimate Revolution:** after your R starts (instant casts) or ends (duration casts), its cooldown resets once,
  so you get a second R. 75s cooldown, reset on death (wiki), so an unused second R is ready again after respawn
  (Nico). Best on Karthus, Malphite, Renata Glasc and Amumu.
- **Spell Split:** split missiles keep the full effect: Blitzcrank's split hooks pull, and Nidalee's split spears
  keep the distance damage (Nico). Later hits on the same target from one cast deal 30% (wiki).
- **Shark Bait:** you probably can't cast during the zombie state (Nico, not sure). It ranks high on Udyr, Nunu,
  Lissandra and Fiddlesticks mostly because they dive and die often.
- **Fey Magic:** the polymorph is a disarm plus slow, not an immobilize, so it doesn't trigger Cruelty (Nico).
- **Chain Reaction:** only offered to champions with a knock-back (21 in our data). Collisions with champions knock
  up; with terrain, the target rebounds, takes more damage and is stunned. On an R it deals 250% (wiki). Gragas
  takes it most (his #1 augment): E knocks back often and his R has long range, so targets often hit each other
  or a wall (Nico). Next most: Qiyana, Syndra, Gnar, Lee Sin, Alistar, Taliyah, Poppy.
- **Ominous Pact:** Singed's Q toggle pays the 5% health cost once per toggle, so it's almost free (Nico).
- **Master of Duality:** Katarina's daggers count as ability hits, and all stacks fall off together after 5s
  without a hit (Nico).
- **Multishot:** goes on Q for Vel'Koz, Ekko and Lux (Nico).
- **Chain Reaction on Qiyana and Lee Sin:** Qiyana gets it on R (terrain shockwave, 250% damage). On Lee Sin's R
  kick it possibly stacks with the kick's own hit on champions behind (Nico, not sure).
- **Can't Touch This on Udyr:** only his R stance counts as an ultimate cast (Nico).
- **One Hit Wonder + Purist - Caster:** pick order matters. If One Hit Wonder is taken first, Purist's haste is
  not converted into One Hit Wonder damage; if taken after, it is (Nico). So take Purist - Caster first.
  One Hit Wonder only ignores general ability haste. Direct cooldown effects still shorten that ability: Bread
  augments (per-ability haste), Spear of Shojin, ultimate haste and similar. So you can keep the cooldown short
  while all general haste turns into damage, which also avoids haste's diminishing returns (Nico).
- **Triggered Inferno on Hecarim:** its move speed feeds his passive's speed-to-AD conversion, so hitting
  different targets in turn stacks AD (Nico).
- **Heavy Is The Crown on Yuumi:** the move speed penalty doesn't matter while she's attached (Nico).
- **Double Time:** the permanent mana pays off on Ryze and Kassadin (mana scaling). Cassiopeia and Anivia have no
  mana scaling, but they spend a lot and hit with two abilities often, so it procs constantly (Nico).
- **Ominous Pact on Vladimir:** the 5% current-health cost stacks on his own health costs, and the missing-health
  AP and omnivamp make up for it (Nico).
- **Juiced:** Ezreal's Q applies it, since his Q applies on-hit (Nico, believes).
- **Glass Cannon:** a health ceiling you can't heal past, so effectively less health, for bonus true damage
  (Nico).
- **Gift of the Drowned:** Cho'Gath R stacks and Sion W stacks probably count as bonus health (Nico, not sure).
- **It's Killing Time:** Karthus's global R marks the whole enemy team. On Udyr only his R stance triggers it
  (Nico).
- **RISE:** works on long ults like Karthus R and Fiddlesticks R (Nico).
- **Rite of Ascension on Pyke:** R resets plus the essence blink can chain through a whole team (Nico).
- **Endless Decimation on Darius:** the auto-cast Q probably doesn't apply his bleed stacks (Nico, not sure).
- **Still Here on Olaf:** stacks with his passive's missing-health attack speed (Nico, thinks so).
- **Tickle Monster:** a trap on Graves and Kled too, since reload/ammo limits their attacks (Nico).
- **Impassable:** grants Aftershock and Glacial Augment (Nico).
- **Back To Basics:** you keep your R's passive and only lose the active. Best on champions whose R is
  situational, like Taliyah, Ryze, Pantheon and Twisted Fate (Nico).
- **Quickstep:** its dash triggers Dashing, Earthwake and Shadow Runner (Nico, thinks so).
- **Soul Siphon:** does NOT heal from Vulnerability burn crits in Mayhem (Arena may) (Nico, thinks so).
- **Thread the Needle:** stacks with Void Staff and Lord Dominik's (Nico).
- **Chain Reaction:** only upgrades abilities, not summoner spells like Brass Blast (Nico, probably).
- **Holy Snowball:** matters least on tanky champions without big burst, who don't need a short invulnerability
  (Nico).
- **Courage of the Colossus:** one shield per cast, even for multi-hit CC (Nico).
- **Volibear passive + BEES!!! + Statikk Shiv:** at full passive stacks his attacks chain lightning. BEES on-hit
  ticks and Statikk Shiv procs trigger that chain on every enemy hit, so the lightning spreads through the whole
  swarm (Nico).
- **Terror:** always on R for every champion, never a rolled basic ability (Nico). check_build.py blocks it on
  any other ability. Terror on Vayne's Tumble, Xin Zhao's E or Renekton's E is impossible.
- **Vayne:** Tumble counts as a dash for Earthwake. Chain Reaction on Condemn likely stacks the rebound stun with
  Condemn's own stun (Nico, guessing).
- **Xin Zhao:** Chain Reaction goes on R (Crescent Guard) (Nico).
- **Renekton:** both Slice and Dice dashes trigger Earthwake (Nico).
- **Sion:** Stackosaurus Rex doubles his W Health stacks, and charging Q counts as a channel (Nico).
- **Akshan:** RISE works with his R (each recast is a full R), and the R charge-up counts as a channel (Nico).
- **Gragas:** Ravenous Bind heals off Chain Reaction knock-ups (Nico).
- **RISE:** R only. Gragas can't take it on E (Nico).
- **Syndra:** Chain Reaction can go on E (Scatter the Weak), but the pushed spheres don't count as knocked-back
  champions (Nico).
- **Illaoi:** Minionmancer buffs her tentacles, and Echo Cast's clone Q makes a second tentacle slam (Nico).
- **Aurelion Sol:** Stackosaurus Rex doubles Stardust, and Breath of Light (Q) counts as a channel (Nico).
- **Overflow on Nunu:** it raises W's cast cost only, not a per-second cost (Nico).
- **Janna:** Group Hug makes E shield 3 allies at once (Nico).
- **Infernal Conduit:** its burn can crit through Vulnerability, like Liandry's (Nico).
- **Fiddlesticks:** both the W drain and the R channel count for Don't Change the Channel, and the drain heal sets
  off Circle of Death (Nico).
- **Pin Cushion:** very weak damage for a prismatic, worse still on melee champions with few attacks (Nico).
- **Pin Cushion on Ashe:** each arrow of her empowered Q volley counts as a separate hit (Nico). Zeri's Q (Burst Fire)
  likely works the same (Nico). Data check: Ashe is first on Pin Cushion's best-champions list and grades A
  with it. Zeri takes it most of anyone (5.6%, grade A) but isn't on the best list, so her case is unconfirmed.
- **Terrain'd:** the AP Trundle items (Horizon Focus, Bloodletter's, Cryptbloom, Imperial Mandate) likely center
  on it (Nico, probably).
- **Tahm Kench AP (Rabadon's, Shadowflame, Dusk and Dawn, Riftmaker):** likely BEES or Ethereal Weapon + Dusk and
  Dawn, since one Q can stun a far target and R works too. With Goliath and/or Mad Scientist he already has the
  size, so Health is less needed (Nico, guess). Goliath, Ethereal Weapon and Mad Scientist are all top-6 on him.
- **Ryze (Infinite Ryze):** W and E still reset Q in Mayhem. Lich Brain is 30 AP + 4% bonus Health as AP (the game
  files leave the numbers out). Eureka's haste (30% AP) has no cap. Double Time's +25 max Mana is multiplied by
  Ryze's passive. Mind to Matter stops at 99,999 Health, so the "infinite" AP loop levels off around 25,600 AP
  (Nico).

## Items

- **Moonstone Renewer:** its chained heal or shield triggers ally augments (Sound Barrier, Sonic Boom, Spirit
  Bomb) (Nico).
- **Hextech Rocketbelt:** its dash triggers Earthwake, Shadow Runner, Swift and Safe and Outlaw's Grit, but not
  Dashing (Nico).
- **Actualizer and Overflow:** they stack to 4x mana costs, which feeds Blue Barrier and Rod of Ages (Nico).
- **Liandry's Torment:** its burn can crit through Vulnerability (Nico).
- **Blade of the Ruined King:** current-Health on-hit damage, so any champion with attack speed does real
  damage (Nico).
- **Jeweled Gauntlet:** the only way Kha'Zix's Q can crit, which is why crit items do well on him (Nico).
- **Spear of Shojin:** Yorick's ghoul and Maiden damage count as his own ability damage (Nico, believes).
- **Muramana / Archangel's:** Overflow is best on champions that already build them (Ezreal, Gangplank, Udyr)
  (Nico, assumes).
- **Bard's Meeps:** on-attack bonus magic damage that counts as spell damage, so Meeps themselves don't apply
  on-hit. The basic attack still does, so on-hit items work normally (wiki).

- **Reading item stats:** an item that does unusually well on a champion often signals an augment, not the item
  itself (Nico). Death's Dance on Corki means Draw Your Sword (stronger melee modifier). Statikk Shiv on Teemo
  means Ethereal Weapon (Shiv doesn't apply his E poison, but abilities do with Ethereal). Overlord's Bloodmail on
  Vladimir means ADAPt. Jak'Sho on Rakan means Protein Shake or Armored Impact. Liandry's on Yorick means AP Yorick,
  which is weak without a specific augment combo.
- **Enchanter items on Karma:** her empowered E shield triggers each item on every ally it hits (Nico).
- **Stormsurge on Teemo:** shroom damage can trigger it if there is enough (Nico).
- **Eclipse:** weak on everyone because other items and augments outclass its effect (Nico).
- **Illaoi:** her tentacles don't proc Spellblade (Iceborn), unless maybe with Ethereal Weapon (Nico, not sure).
- **Tahm Kench:** tank Tahm is still strong. Thornmail is a reactive buy against heavy healing, and Jak'Sho
  matters less since his scalings are health, not resistances (Nico).
- **Master Yi:** strongest spamming Q with Mystic Punch. If Q applies on-hit at all it's weaker than crit (Nico).
- **Bruiser items are weak in Mayhem.** Go crit/lethality or tank on Vi and Wukong, not a mix (Nico).
- **Rek'Sai:** her best full builds stack health (Heartsteel, Warmog's, Overlord's Bloodmail, Titanic Hydra,
  Unending Despair, Spirit Visage, Mercury's). Builds with Thornmail, Plated Steelcaps or Randuin's do worst (data).
- **Anti-heal (Morellonomicon):** good when no teammate applies it better. Its numbers look worse partly because
  it's bought against strong healing teams, which are harder to beat (Nico).
- **Quinn:** a crit champion, not a sustained on-hit one, so Statikk Shiv underperforms (Nico).
- **Lucian:** strongest with Jeweled Gauntlet + Vulnerability + Jeweled Bracelet empowering his R, so on-hit and
  attack speed don't matter (Nico).
- **Kog'Maw:** Navori refunds W, but it's likely only good with Vulnerability, which lets W damage crit. He
  usually builds AP on-hit (Nico).

## Data limits

- The site has no real augment-pair data. "Augment combinations" are model estimates (product of pick rates),
  so they can't show which augments are actually taken together.
- Augment pairs confirmed here also go in `data/estimates/augment_synergy_rules.json`, which re-ranks a champion
  page's augments after a visitor marks the ones they took.
