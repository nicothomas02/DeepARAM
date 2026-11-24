window.ASHE_DATA = {
 "patch": "16.23.8413489",
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
 ],
 "items": [
  {
   "id": 3158,
   "name": "Ionian Boots of Lucidity",
   "price": 900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3158_class_t2_ionianbootsoflucidity.png",
   "haste": 10.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "Items/ItemGroups/Boots",
    "Items/ItemGroups/BootsWithoutActives"
   ]
  },
  {
   "id": 3118,
   "name": "Malignance",
   "price": 2700,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3118_malignance.png",
   "haste": 15.0,
   "ultHaste": 20.0,
   "limitGroups": [
    "{143b41c4}"
   ]
  },
  {
   "id": 4005,
   "name": "Imperial Mandate",
   "price": 2400,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4005_enchanter_t4_imperialmandate.png",
   "haste": 15.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{5f2a99fe}"
   ]
  },
  {
   "id": 4628,
   "name": "Horizon Focus",
   "price": 2700,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4628_mage_t3_horizonfocus.png",
   "haste": 25.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{466ecfe1}"
   ]
  },
  {
   "id": 3137,
   "name": "Cryptbloom",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3137_cryptbloom.png",
   "haste": 20.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "Items/ItemGroups/VoidPen"
   ]
  },
  {
   "id": 3089,
   "name": "Rabadon's Deathcap",
   "price": 3500,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3089_mage_t3_deathcap.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{ac92b6ad}",
    "Items/ItemGroups/APMultiplier"
   ]
  },
  {
   "id": 4645,
   "name": "Shadowflame",
   "price": 3200,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4645_shadowflame.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{bd7d02c0}"
   ]
  },
  {
   "id": 2503,
   "name": "Blackfire Torch",
   "price": 2800,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/2503_blackfiretorch64.png",
   "haste": 20.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{693b07b5}"
   ]
  },
  {
   "id": 3115,
   "name": "Nashor's Tooth",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3115_mage_t3_nashorstooth.png",
   "haste": 15.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{093b3073}"
   ]
  },
  {
   "id": 4629,
   "name": "Cosmic Drive",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4629_mage_t3_cosmicdrive.png",
   "haste": 25.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{456ece4e}"
   ]
  },
  {
   "id": 3165,
   "name": "Morellonomicon",
   "price": 2850,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3165_mage_t3_morellonomicon.png",
   "haste": 15.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{0938f1dc}"
   ]
  },
  {
   "id": 4633,
   "name": "Riftmaker",
   "price": 3100,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4633_mage_t4_riftmaker.png",
   "haste": 15.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{bb6bb679}"
   ]
  },
  {
   "id": 3100,
   "name": "Lich Bane",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3100_mage_t3_lichbane.png",
   "haste": 10.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{123d7d35}",
    "{8b55a7b3}"
   ]
  },
  {
   "id": 6655,
   "name": "Luden's Echo",
   "price": 2750,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/6655_mage_t4_ludenstempest.png",
   "haste": 10.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{3c60030b}"
   ]
  },
  {
   "id": 3040,
   "name": "Seraph's Embrace",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3048_mage_t3_seraphsembrace.png",
   "haste": 25.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{2bb000ae}",
    "Items/ItemGroups/LifelineItems"
   ]
  },
  {
   "id": 3003,
   "name": "Archangel's Staff",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3003_mage_t3_archangelstaff.png",
   "haste": 25.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "Items/ItemGroups/TearItems",
    "Items/ItemGroups/LifelineItems",
    "{2bb000ae}"
   ]
  },
  {
   "id": 8020,
   "name": "Abyssal Mask",
   "price": 2650,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/8020_tank_t3_abyssalmask.png",
   "haste": 15.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{d4211923}"
   ]
  },
  {
   "id": 3152,
   "name": "Hextech Rocketbelt",
   "price": 2650,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3152_mage_t4_hextechrocketbelt.png",
   "haste": 10.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{9631810e}"
   ]
  },
  {
   "id": 6653,
   "name": "Liandry's Torment",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/6653_mage_t4_liandrysanguish.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{42600c7d}"
   ]
  },
  {
   "id": 4646,
   "name": "Stormsurge",
   "price": 2800,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4646_stormsurge.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{c07d0779}"
   ]
  },
  {
   "id": 3135,
   "name": "Void Staff",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3135_mage_t3_voidstaff.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "Items/ItemGroups/VoidPen"
   ]
  },
  {
   "id": 3157,
   "name": "Zhonya's Hourglass",
   "price": 3250,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3157_mage_t3_zhonyashourglass.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{9b3188ed}"
   ]
  },
  {
   "id": 3102,
   "name": "Banshee's Veil",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3102_mage_t3_bansheesveil.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{103d7a0f}",
    "{3fcdbdac}"
   ]
  },
  {
   "id": 6657,
   "name": "Rod of Ages",
   "price": 2600,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/6657_mage_t4_rodofages.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "Items/ItemGroups/EternityItems",
    "{3e600631}"
   ]
  },
  {
   "id": 3116,
   "name": "Rylai's Crystal Scepter",
   "price": 2600,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3116_mage_t3_rylajscrystalscepter.png",
   "haste": 0.0,
   "ultHaste": 0.0,
   "limitGroups": [
    "{0a3b3206}"
   ]
  }
 ]
};
