window.KARMA_DATA = {
 "patch": "16.23.8413489",
 "channel": "latest",
 "champion": {
  "name": "Karma",
  "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/43.png",
  "spells": {
   "Q": {
    "name": "Inner Flame",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/karma/hud/icons2d/karma_q1.png",
    "cooldown": [
     9.0,
     8.0,
     7.0,
     6.0,
     5.0
    ],
    "mana": [
     40.0,
     50.0,
     60.0,
     70.0,
     80.0
    ],
    "castTime": 0.25
   },
   "W": {
    "name": "Focused Resolve",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/karma/hud/icons2d/karma_w1.png",
    "cooldown": [
     12.0,
     12.0,
     12.0,
     12.0,
     12.0
    ],
    "mana": [
     50.0,
     55.0,
     60.0,
     65.0,
     70.0
    ],
    "castTime": 0.25
   },
   "E": {
    "name": "Inspire",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/karma/hud/icons2d/karma_e1.png",
    "cooldown": [
     10.0,
     9.5,
     9.0,
     8.5,
     8.0
    ],
    "mana": [
     60.0,
     65.0,
     70.0,
     75.0,
     80.0
    ],
    "castTime": 0.0
   },
   "R": {
    "name": "Mantra",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/karma/hud/icons2d/karma_r.png",
    "cooldown": [
     40.0,
     38.0,
     36.0,
     34.0
    ],
    "mana": [
     0,
     0,
     0,
     0
    ],
    "castTime": 0.0
   }
  },
  "passiveCut": 4.0,
  "soulflareDelay": 1.5,
  "tether": 2.0,
  "baseMana": 374.0,
  "manaPerLevel": 40.0,
  "manaRegen": 2.5999999046325684,
  "manaRegenPerLevel": 0.1599999964237213
 },
 "augments": [
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
   "key": "UltimateAwakening",
   "id": 1349,
   "name": "Ultimate Awakening",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/mayhem/augments/icons/zerohour_small.png",
   "values": {
    "Cooldown": 20.0,
    "AH": 30.0,
    "AdditionalHaste": 300.0,
    "BuffDuration": 15.0
   },
   "calcs": {},
   "text": "Casting your ultimate ability resets the of all your basic abilities and grants you 300 basic ability haste for 15 seconds (20 second cooldown). Additionally, gain 30 ultimate haste."
  },
  {
   "key": "ARAM_UltimateRevolution",
   "id": 1088,
   "name": "Ultimate Revolution",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/ultimaterevolution_small.png",
   "values": {
    "Cooldown": 75.0
   },
   "calcs": {},
   "text": "Casting your ultimate ability resets its once its effect or has (75 second cooldown, reset upon death)."
  },
  {
   "key": "UltimateRecursion",
   "id": 3055,
   "name": "Ultimate Recursion",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/mayhem/augments/icons/zealot_large.png",
   "values": {
    "UltimateHaste": 50.0
   },
   "calcs": {},
   "text": "Gain 50 ultimate haste."
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
   "key": "ARAM_EtherealWeapon",
   "id": 1029,
   "name": "Ethereal Weapon",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/etherealweapon_small.png",
   "values": {
    "Cooldown": 1.5
   },
   "calcs": {},
   "text": "Your abilities apply on-hit effects (1 second cooldown per target)."
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
   "key": "ARAM_BreadAndJam",
   "id": 1150,
   "name": "Bread And Jam",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/mayhem/augments/icons/genericabilityaugmenticon_gold.png",
   "values": {
    "WAbilityHaste": 100.0
   },
   "calcs": {},
   "text": "Your champion's second basic ability (W) gains 100 ability haste."
  },
  {
   "key": "ARAM_BreadAndCheese",
   "id": 1151,
   "name": "Bread and Cheese",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/mayhem/augments/icons/genericabilityaugmenticon_gold.png",
   "values": {
    "EAbilityHaste": 100.0
   },
   "calcs": {},
   "text": "Your champion's third basic ability (E) gains 100 ability haste."
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
