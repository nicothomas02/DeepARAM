window.ASHE_DATA = {
 "patch": "16.23.8406595",
 "channel": "latest",
 "champion": {
  "name": "Ashe",
  "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/22.png",
  "spells": {
   "W": {
    "name": "Volley",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/ashe/hud/icons2d/ashe_w.png",
    "cooldown": [
     18.0,
     14.5,
     11.0,
     7.5,
     4.0
    ],
    "castTime": 0.25
   },
   "E": {
    "name": "Hawkshot",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/ashe/hud/icons2d/ashe_e.png",
    "cooldown": [
     5.0,
     5.0,
     5.0,
     5.0,
     5.0
    ],
    "castTime": 0.25,
    "charges": 2,
    "recharge": [
     90.0,
     80.0,
     70.0,
     60.0,
     50.0
    ]
   },
   "R": {
    "name": "Enchanted Crystal Arrow",
    "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/ashe/hud/icons2d/ashe_r.png",
    "cooldown": [
     100.0,
     80.0,
     60.0
    ],
    "castTime": 0.25
   }
  }
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
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/zerohour_small.png",
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
   "key": "UltimateRecursion",
   "id": 3055,
   "name": "Ultimate Recursion",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/zealot_large.png",
   "values": {
    "UltimateHaste": 50.0
   },
   "calcs": {},
   "text": "Gain 50 ultimate haste."
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
   "key": "ARAM_BreadAndCheese",
   "id": 1151,
   "name": "Bread and Cheese",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/genericabilityaugmenticon_gold.png",
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
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/puristcaster_small.png",
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
