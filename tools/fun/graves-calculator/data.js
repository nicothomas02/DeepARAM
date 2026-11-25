window.GRAVES_DATA = {
 "patch": "16.23.8413489",
 "channel": "latest",
 "champion": {
  "name": "Graves",
  "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/104.png",
  "spells": {
   "Q": {
    "name": "End of the Line",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/graves/hud/icons2d/gravesq.png",
    "cooldown": [
     13.0,
     11.25,
     9.5,
     7.75,
     6.0
    ],
    "mana": [
     80.0,
     80.0,
     80.0,
     80.0,
     80.0
    ],
    "castTime": 0.25
   },
   "W": {
    "name": "Smoke Screen",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/graves/hud/icons2d/gravesw.png",
    "cooldown": [
     26.0,
     24.0,
     22.0,
     20.0,
     18.0
    ],
    "mana": [
     70.0,
     75.0,
     80.0,
     85.0,
     90.0
    ],
    "castTime": 0.25
   },
   "E": {
    "name": "Quickdraw",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/graves/hud/icons2d/gravese.png",
    "cooldown": [
     16.0,
     15.0,
     14.0,
     13.0,
     12.0
    ],
    "mana": [
     40.0,
     40.0,
     40.0,
     40.0,
     40.0
    ],
    "castTime": 0.4,
    "cutPerPellet": 0.5,
    "armorPerStack": [
     7.0,
     10.0,
     13.0,
     16.0,
     19.0
    ],
    "maxStacks": 8.0,
    "stackTime": 4.0
   },
   "R": {
    "name": "Collateral Damage",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/graves/hud/icons2d/gravesr.png",
    "cooldown": [
     100.0,
     80.0,
     60.0
    ],
    "mana": [
     100.0,
     100.0,
     100.0
    ],
    "castTime": 0.25
   }
  },
  "attack": {
   "baseAS": 0.475,
   "ratioAS": 0.49,
   "pellets": 4,
   "critPellets": 6,
   "reload2": 2.08,
   "reloadCap": 0.891,
   "reloadCapBonusAS": 1.5
  },
  "baseMana": 325.0,
  "manaPerLevel": 40.0,
  "manaRegen": 1.600000023841858,
  "manaRegenPerLevel": 0.14000000059604645
 },
 "augments": [
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
