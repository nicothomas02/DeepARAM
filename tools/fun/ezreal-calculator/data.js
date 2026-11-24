window.EZREAL_DATA = {
 "patch": "16.23.8413489",
 "channel": "latest",
 "champion": {
  "name": "Ezreal",
  "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/81.png",
  "spells": {
   "Q": {
    "name": "Mystic Shot",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/ezreal/hud/icons2d/ezreal_q.png",
    "cooldown": [
     5.5,
     5.25,
     5.0,
     4.75,
     4.5
    ],
    "mana": [
     31.0,
     34.0,
     37.0,
     40.0,
     43.0
    ],
    "castTime": 0.25,
    "refund": 1.5,
    "speed": 2000.0,
    "range": 1200.0
   },
   "W": {
    "name": "Essence Flux",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/ezreal/hud/icons2d/ezreal_w.png",
    "cooldown": [
     8.0,
     8.0,
     8.0,
     8.0,
     8.0
    ],
    "mana": [
     50.0,
     50.0,
     50.0,
     50.0,
     50.0
    ],
    "castTime": 0.25
   },
   "E": {
    "name": "Arcane Shift",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/ezreal/hud/icons2d/ezreal_e.png",
    "cooldown": [
     26.0,
     23.0,
     20.0,
     17.0,
     14.0
    ],
    "mana": [
     70.0,
     70.0,
     70.0,
     70.0,
     70.0
    ],
    "castTime": 0.25
   },
   "R": {
    "name": "Trueshot Barrage",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/ezreal/hud/icons2d/ezreal_r.png",
    "cooldown": [
     120.0,
     105.0,
     90.0
    ],
    "mana": [
     100.0,
     100.0,
     0.0
    ],
    "castTime": 1.0
   }
  },
  "baseMana": 375.0,
  "manaPerLevel": 70.0,
  "manaRegen": 1.7000000476837158,
  "manaRegenPerLevel": 0.20000000298023224
 },
 "augments": [
  {
   "key": "ARAM_SkilledSniper",
   "id": 1113,
   "name": "Skilled Sniper",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/skilledsniper_small.png",
   "values": {
    "SnipeDistance": 600.0,
    "ReducedCooldownPercent": 0.800000011920929,
    "PeriodicReductionAmount": 0.6499999761581421
   },
   "calcs": {},
   "text": "Hitting an enemy champion with a basic ability while located at least 600 units away from them at the time of the hit reduces its current cooldown by 80% of its total cooldown, modified to 65% for damage over time abilities."
  },
  {
   "key": "ARAM_Archmage",
   "id": 2087,
   "name": "Archmage",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/eureka_small.png",
   "values": {
    "RefundPercent": 0.30000001192092896,
    "MaxLevel": 1.0
   },
   "calcs": {},
   "text": "Whenever you cast an ability, refund the cooldown of another, randomly selected ability by 30% of the casted ability's base cooldown."
  },
  {
   "key": "ARAM_MysticPunch",
   "id": 1058,
   "name": "Mystic Punch",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/mysticpunch_small.png",
   "values": {
    "CooldownRefund": 1.25,
    "MinCDR": 0.5
   },
   "calcs": {},
   "text": "Basic attacks on-hit reduce the remaining cooldowns of your abilities by 1.25 seconds."
  },
  {
   "key": "ARAM_BreadAndButter",
   "id": 1103,
   "name": "Bread And Butter",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/mayhem/augments/icons/genericabilityaugmenticon_gold.png",
   "values": {
    "QAbilityHaste": 100.0,
    "QReducedAbilityHaste": 100.0
   },
   "calcs": {},
   "text": "Your champion's first basic ability (Q) gains 100 ability haste."
  },
  {
   "key": "ARAM_Purist_Caster",
   "id": 2018,
   "name": "Purist - Caster",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/mayhem/augments/icons/puristcaster_small.png",
   "values": {
    "CooldownReduction": 0.1,
    "Haste_Per_AS": 0.6499999761581421,
    "MaxLevel": 1.0
   },
   "calcs": {},
   "text": "Convert all of your bonus attack speed into ability haste at a rate of 0.65 ability haste per 1% bonus attack speed. Additionally, your abilities' total cooldowns are reduced by 10%."
  }
 ]
};
