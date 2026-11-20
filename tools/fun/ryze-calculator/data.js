window.RYZE_DATA = {
 "patch": "16.23.8406595",
 "channel": "latest",
 "champion": {
  "name": "Ryze",
  "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/13.png",
  "baseHP": 620.0,
  "hpPerLevel": 124.0,
  "baseMana": 300.0,
  "manaPerLevel": 70.0,
  "passiveManaPctPer100AP": 0.1,
  "passiveAPStep": 100.0,
  "spells": {
   "Q": {
    "base": [
     75.0,
     95.0,
     115.0,
     135.0,
     155.0
    ],
    "apRatio": 0.55,
    "bonusManaRatio": 0.02,
    "cooldown": [
     5.0,
     5.0,
     5.0,
     5.0,
     5.0
    ],
    "mana": [
     38.0,
     36.0,
     34.0,
     32.0,
     32.0
    ],
    "castTime": 0.25
   },
   "W": {
    "base": [
     60.0,
     90.0,
     120.0,
     150.0,
     180.0
    ],
    "apRatio": 0.7,
    "bonusManaRatio": 0.03,
    "cooldown": [
     11.0,
     10.5,
     10.0,
     9.5,
     9.0
    ],
    "mana": [
     60.0,
     70.0,
     80.0,
     90.0,
     100.0
    ],
    "castTime": 0.25
   },
   "E": {
    "base": [
     60.0,
     90.0,
     120.0,
     150.0,
     180.0
    ],
    "apRatio": 0.5,
    "bonusManaRatio": 0.02,
    "cooldown": [
     3.5,
     3.25,
     3.0,
     2.75,
     2.5
    ],
    "mana": [
     50.0,
     60.0,
     70.0,
     80.0,
     90.0
    ],
    "castTime": 0.25
   }
  }
 },
 "items": [
  {
   "id": 3040,
   "name": "Seraph's Embrace",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3048_mage_t3_seraphsembrace.png",
   "ap": 70.0,
   "mana": 1000.0,
   "hp": 0.0,
   "haste": 25.0,
   "values": {
    "APFromMana": 0.019999999552965164,
    "HealthThreshold": 0.30000001192092896,
    "ShieldDuration": 3.0,
    "LifelineCooldown": 75.0,
    "Cooldown": 75.0
   },
   "calcs": {
    "ShieldValue": {
     "flat": 0,
     "manaRatio": 0.18000000715255737,
     "bonusOnly": false,
     "multiplier": 1.0
    },
    "BonusAPCalc": {
     "flat": 0,
     "manaRatio": 0.019999999552965164,
     "bonusOnly": true,
     "multiplier": 1.0
    }
   },
   "limitGroups": [
    "{2bb000ae}",
    "Items/ItemGroups/LifelineItems"
   ],
   "text": "70 Ability Power 1000 Mana 25 Ability Haste Awe Gain Ability Power. Lifeline (0s) Taking damage that would reduce your Health below 30% grants a Shield for 3 seconds."
  },
  {
   "id": 3003,
   "name": "Archangel's Staff",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3003_mage_t3_archangelstaff.png",
   "ap": 70.0,
   "mana": 600.0,
   "hp": 0.0,
   "haste": 25.0,
   "values": {
    "ManaPerCharge": 7.5,
    "ManaChargeAmmoCD": 8.0,
    "ManaChargeMaxAmmo": 5.0,
    "MaxMana": 360.0,
    "InternalCDPerCastID": 6.5,
    "APFromMana": 0.009999999776482582
   },
   "calcs": {},
   "limitGroups": [
    "Items/ItemGroups/TearItems",
    "Items/ItemGroups/LifelineItems",
    "{2bb000ae}"
   ],
   "text": "70 Ability Power 600 Mana 25 Ability Haste Awe Gain Ability Power equal to 1% bonus Mana. Manaflow (8s, max 5 charges) Landing Abilities grants 5 max Mana (doubled vs. champions). Transforms into Seraph's Embrace at 360 max Mana."
  },
  {
   "id": 3089,
   "name": "Rabadon's Deathcap",
   "price": 3500,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3089_mage_t3_deathcap.png",
   "ap": 130.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 0.0,
   "values": {
    "APAmp": 0.30000001192092896
   },
   "calcs": {},
   "limitGroups": [
    "{ac92b6ad}",
    "Items/ItemGroups/APMultiplier"
   ],
   "text": "130 Ability Power Magical Opus Increases your total Ability Power by 30%."
  },
  {
   "id": 228002,
   "name": "Wooglet's Witchcap",
   "price": 6000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3385_forge_wooglets_witchcap.png",
   "ap": 300.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 20.0,
   "values": {
    "APAmp": 0.5,
    "Cooldown": 60.0,
    "Duration": 2.5
   },
   "calcs": {},
   "limitGroups": [
    "{71eded8d}",
    "{9b3188ed}",
    "{ac92b6ad}"
   ],
   "text": "300 Ability Power 50 Armor 20 Ability Haste Magical Opus: Increases your total Ability Power by 50% (0). Time Stop Enter Stasis for 2.5 seconds."
  },
  {
   "id": 6657,
   "name": "Rod of Ages",
   "price": 2600,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/6657_mage_t4_rodofages.png",
   "ap": 45.0,
   "mana": 500.0,
   "hp": 350.0,
   "haste": 0.0,
   "values": {
    "HealthPerStack": 10.0,
    "ManaPerStack": 30.0,
    "APPerStack": 3.0,
    "MaxStacks": 10.0,
    "EternityManaRestore": 0.10000000149011612,
    "EternityHealthRestore": 0.25,
    "EternityMaxHealPerCast": 20.0,
    "EternityCDPerCast": 1.0,
    "SecondsPerStack": 40.0
   },
   "calcs": {},
   "limitGroups": [
    "Items/ItemGroups/EternityItems",
    "{3e600631}"
   ],
   "text": "45 Ability Power 350 Health 500 Mana Timeless This item gains 10 Health, 30 Mana and 3 Ability Power every 60 seconds up to 10 times. Upon reaching max stacks, gain a level. Eternity Taking damage from champions restores 10% of the damage as Mana. Casting an ability heals for 25% of Mana spent."
  },
  {
   "id": 2503,
   "name": "Blackfire Torch",
   "price": 2800,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/2503_blackfiretorch64.png",
   "ap": 80.0,
   "mana": 600.0,
   "hp": 0.0,
   "haste": 20.0,
   "values": {
    "BurnFlatDamagePerSecond": 20.0,
    "APRatio": 0.019999999552965164,
    "BurnDuration": 3.0,
    "MonsterDamageBonus": 20.0,
    "TickFrequency": 0.5,
    "APPerStack": 0.03999999910593033,
    "MinionDPS": 20.0,
    "MinionAP": 0.019999999552965164,
    "MonsterDPS": 40.0,
    "MonsterAP": 0.019999999552965164
   },
   "calcs": {},
   "limitGroups": [
    "{693b07b5}"
   ],
   "text": "80 Ability Power 600 Mana 20 Ability Haste Baleful Blaze Damaging Abilities deals bonus magic damage for 3 seconds. Blackfire For each enemy champion, epic and large monster affected by your Baleful Blaze, gain 4% Ability Power."
  },
  {
   "id": 3118,
   "name": "Malignance",
   "price": 2700,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3118_malignance.png",
   "ap": 90.0,
   "mana": 600.0,
   "hp": 0.0,
   "haste": 15.0,
   "values": {
    "AOESize": 250.0,
    "UltimateHaste": 20.0,
    "GroundDuration": 3.0,
    "BaseDamage": 40.0,
    "APRatio": 0.02800000086426735,
    "MaxRadius": 550.0
   },
   "calcs": {},
   "limitGroups": [
    "{143b41c4}"
   ],
   "text": "90 Ability Power 600 Mana 15 Ability Haste Scorn Gain 20 Ultimate Ability Haste. Hatefog Damaging a champion with your Ultimate burns the ground beneath them for 3s, dealing magic damage per second and reducing their Magic Resist."
  },
  {
   "id": 6655,
   "name": "Luden's Echo",
   "price": 2750,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/6655_mage_t4_ludenstempest.png",
   "ap": 100.0,
   "mana": 600.0,
   "hp": 0.0,
   "haste": 10.0,
   "values": {
    "Cooldown": 12.0,
    "BaseDamage": 75.0,
    "APRatio": 0.05000000074505806,
    "MaxCharges": 6.0,
    "RepeatDamageReduction": 0.20000000298023224,
    "MissileRange": 650.0
   },
   "calcs": {},
   "limitGroups": [
    "{3c60030b}"
   ],
   "text": "100 Ability Power 600 Mana 10 Ability Haste Echo Damaging Abilities fire 6 Echoes that deal bonus magic damage to the target and nearby enemies. Remaining Echoes fire on the primary target, dealing 20% damage."
  },
  {
   "id": 2522,
   "name": "Actualizer",
   "price": 2800,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/2522_manaactive.png",
   "ap": 90.0,
   "mana": 300.0,
   "hp": 0.0,
   "haste": 10.0,
   "values": {
    "Cooldown": 60.0,
    "Duration": 8.0,
    "ManaCostIncrease": 1.0,
    "CooldownTick": 0.30000001192092896,
    "OverflowAddition": 3.0,
    "OverflowRevert": 1.0
   },
   "calcs": {
    "ManaCalc": {
     "flat": 15.0,
     "manaRatio": 0.004999999888241291,
     "bonusOnly": true,
     "multiplier": 0.009999999776482582
    }
   },
   "limitGroups": [
    "{f0405968}"
   ],
   "text": "90 Ability Power 300 Mana 10 Ability Haste Mana Made Real (0s) For 8 seconds, your mana is Empowered. While Empowered, your spells cost 100% more Mana, you gain increased Ability damage, Shielding, and Healing, and your basic ability cooldowns progress 30% faster."
  },
  {
   "id": 4633,
   "name": "Riftmaker",
   "price": 3100,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4633_mage_t4_riftmaker.png",
   "ap": 70.0,
   "mana": 0.0,
   "hp": 350.0,
   "haste": 15.0,
   "values": {
    "SecondsInCombat": 4.0,
    "EternityDamageIncreasePerSecond": 0.019999999552965164,
    "EternityDamageIncreaseMax": 0.07999999821186066,
    "BuffCounterDuration": 4.0,
    "HealthToAPConversionPercent": 0.019999999552965164,
    "MaxAPMultiplier": 0.05000000074505806,
    "VampAmountMelee": 0.10000000149011612,
    "VampAmountRanged": 0.05999999865889549
   },
   "calcs": {},
   "limitGroups": [
    "{bb6bb679}"
   ],
   "text": "70 Ability Power 350 Health 15 Ability Haste Void Corruption For each second in combat with enemy champions, deal 2% bonus damage, up to 8%. At maximum strength, gain Omnivamp. Void Infusion Gain 2% of your bonus Health as Ability Power."
  },
  {
   "id": 3041,
   "name": "Mejai's Soulstealer",
   "price": 1500,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3041_mage_t2_mejaissoulstealer.png",
   "ap": 20.0,
   "mana": 0.0,
   "hp": 100.0,
   "haste": 0.0,
   "values": {
    "MaxGloryStacks": 25.0,
    "APPerGlory": 5.0,
    "GloryOnKill": 4.0,
    "GloryOnAssist": 2.0,
    "GloryLossOnDeath": 10.0,
    "GloryThreshold": 10.0,
    "MoveSpeedMod": 0.10000000149011612
   },
   "calcs": {},
   "limitGroups": [
    "Items/ItemGroups/Glory"
   ],
   "text": "20 Ability Power 100 Health Glory Takedowns grant Glory, up to 25. 10 Glory is lost on death. Gain 5 Ability Power per Glory and 10% Move Speed at 10 or higher Glory."
  },
  {
   "id": 3121,
   "name": "Fimbulwinter",
   "price": 2400,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3121_fimbulwinter.png",
   "ap": 0.0,
   "mana": 1000.0,
   "hp": 550.0,
   "haste": 15.0,
   "values": {
    "Cooldown": 8.0,
    "ShieldDuration": 3.0,
    "CurrentManaShieldRatio": 0.04500000178813934,
    "Multiplier": 0.800000011920929
   },
   "calcs": {
    "BonusHPFromMana": {
     "flat": 0,
     "manaRatio": 0.15000000596046448,
     "bonusOnly": true,
     "multiplier": 1.0
    }
   },
   "limitGroups": [
    "{9d42d534}"
   ],
   "text": "550 Health 1000 Mana 15 Ability Haste Awe Gain Health. Everlasting (0s) Immobilizing or Slowing ( Melee only) an enemy champion grants a Shield for 3 seconds. The Shield is increased by 80% if more than one enemy is nearby."
  },
  {
   "id": 3119,
   "name": "Winter's Approach",
   "price": 2400,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3119_wintersapproach.png",
   "ap": 0.0,
   "mana": 500.0,
   "hp": 550.0,
   "haste": 15.0,
   "values": {
    "ManaPerCharge": 4.5,
    "ManaChargeAmmoCD": 8.0,
    "ManaChargeMaxAmmo": 4.0,
    "MaxMana": 360.0,
    "InternalCDPerCastID": 6.5
   },
   "calcs": {
    "BonusHPFromMana": {
     "flat": 0,
     "manaRatio": 0.15000000596046448,
     "bonusOnly": true,
     "multiplier": 1.0
    }
   },
   "limitGroups": [
    "Items/ItemGroups/TearItems",
    "{153b4357}",
    "{9d42d534}"
   ],
   "text": "550 Health 500 Mana 15 Ability Haste Awe Gain Health. Manaflow (8s, max 4 charges) Landing Attacks and Abilities grant 3 max Mana (doubled vs. champions). Transforms into Fimbulwinter at 360 max Mana."
  },
  {
   "id": 3110,
   "name": "Frozen Heart",
   "price": 2500,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3110_tank_t3_frozenheart.png",
   "ap": 0.0,
   "mana": 400.0,
   "hp": 0.0,
   "haste": 20.0,
   "values": {
    "ASPDSlow": -0.20000000298023224,
    "AuraRadius": 700.0
   },
   "calcs": {},
   "limitGroups": [
    "{0c3b352c}"
   ],
   "text": "75 Armor 400 Mana 20 Ability Haste Winter's Caress Reduce the Attack Speed of nearby champions by 20%."
  },
  {
   "id": 3157,
   "name": "Zhonya's Hourglass",
   "price": 3250,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3157_mage_t3_zhonyashourglass.png",
   "ap": 105.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 0.0,
   "values": {
    "Cooldown": 120.0,
    "Duration": 2.5
   },
   "calcs": {},
   "limitGroups": [
    "{9b3188ed}"
   ],
   "text": "105 Ability Power 50 Armor Time Stop Enter Stasis for 2.5 seconds."
  },
  {
   "id": 3102,
   "name": "Banshee's Veil",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3102_mage_t3_bansheesveil.png",
   "ap": 105.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 0.0,
   "values": {
    "Cooldown": 40.0
   },
   "calcs": {},
   "limitGroups": [
    "{103d7a0f}",
    "{3fcdbdac}"
   ],
   "text": "105 Ability Power 40 Magic Resist Annul Grants a Spell Shield that blocks the next enemy Ability."
  },
  {
   "id": 3135,
   "name": "Void Staff",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3135_mage_t3_voidstaff.png",
   "ap": 95.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 0.0,
   "values": {},
   "calcs": {},
   "limitGroups": [
    "Items/ItemGroups/VoidPen"
   ],
   "text": "95 Ability Power 40% Magic Penetration"
  },
  {
   "id": 3137,
   "name": "Cryptbloom",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3137_cryptbloom.png",
   "ap": 75.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 20.0,
   "values": {
    "BaseHeal": 100.0,
    "HealAPRatio": 0.20000000298023224,
    "ItemCooldown": 60.0,
    "TakedownWindow": 3.0,
    "Cooldown": 60.0
   },
   "calcs": {},
   "limitGroups": [
    "Items/ItemGroups/VoidPen"
   ],
   "text": "75 Ability Power 30% Magic Penetration 20 Ability Haste Life from Death When a champion that you damaged within 3 seconds dies, a nova spreads from their corpse that heals."
  },
  {
   "id": 4645,
   "name": "Shadowflame",
   "price": 3200,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4645_shadowflame.png",
   "ap": 110.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 0.0,
   "values": {
    "HealthThreshold": 0.4000000059604645,
    "SpellItemDamageAmp": 0.20000000298023224,
    "DamageOverTimeAmp": 0.20000000298023224
   },
   "calcs": {},
   "limitGroups": [
    "{bd7d02c0}"
   ],
   "text": "110 Ability Power 15 Magic Penetration Cinderbloom Magic and true damage Critically Strike enemies below 40% Health, dealing 20% increased damage."
  },
  {
   "id": 4646,
   "name": "Stormsurge",
   "price": 2800,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4646_stormsurge.png",
   "ap": 90.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 0.0,
   "values": {
    "WindowDuration": 2.5,
    "Cooldown": 30.0,
    "DelayDuration": 2.0,
    "APRatio": 0.10000000149011612,
    "DamageThreshold": 0.25,
    "ProcMoveSpeedDuration": 1.5,
    "RangedProcDamageMod": 1.0,
    "BaseDamage": 125.0
   },
   "calcs": {},
   "limitGroups": [
    "{c07d0779}"
   ],
   "text": "90 Ability Power 15 Magic Penetration 6% Move Speed Stormraider Dealing 25% of a champion's maximum Health within 2.5s applies Squall to them. Squall After 2 seconds, deal magic damage. If the target dies before Squall triggers, it damages nearby enemies."
  },
  {
   "id": 6653,
   "name": "Liandry's Torment",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/6653_mage_t4_liandrysanguish.png",
   "ap": 60.0,
   "mana": 0.0,
   "hp": 300.0,
   "haste": 0.0,
   "values": {
    "BurnDuration": 3.0,
    "BurnPercentHealthDamage": 0.017999999225139618,
    "DamageIncreasePerSecond": 0.019999999552965164,
    "DamageIncreaseMax": 0.05999999865889549,
    "TickFrequency": 0.5,
    "MonsterDamageCap": 40.0,
    "MaxDamageHPThreshold": 1250.0,
    "BuffCounterDuration": 3.0,
    "MaxStackNumber": 3.0
   },
   "calcs": {},
   "limitGroups": [
    "{42600c7d}"
   ],
   "text": "60 Ability Power 300 Health Torment Damaging Abilities burn enemies for 2% max Health magic damage per second for 3 seconds. Suffering For each second in combat with enemy champions, deal 2% bonus damage, up to 6%."
  },
  {
   "id": 3116,
   "name": "Rylai's Crystal Scepter",
   "price": 2600,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3116_mage_t3_rylajscrystalscepter.png",
   "ap": 65.0,
   "mana": 0.0,
   "hp": 400.0,
   "haste": 0.0,
   "values": {
    "SlowAmount": 0.30000001192092896,
    "SlowDuration": 1.0
   },
   "calcs": {},
   "limitGroups": [
    "{0a3b3206}"
   ],
   "text": "65 Ability Power 400 Health Rimefrost Damaging Abilities Slow enemies by 30% for 1 second."
  },
  {
   "id": 4629,
   "name": "Cosmic Drive",
   "price": 3000,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4629_mage_t3_cosmicdrive.png",
   "ap": 70.0,
   "mana": 0.0,
   "hp": 350.0,
   "haste": 25.0,
   "values": {
    "StackDuration": 4.0,
    "MaxStacks": 3.0,
    "MovespeedToGrant": 40.0,
    "MaxMovespeedTooltip": 0.15000000596046448,
    "ItemCooldown": 10.0
   },
   "calcs": {},
   "limitGroups": [
    "{456ece4e}"
   ],
   "text": "70 Ability Power 350 Health 25 Ability Haste 4% Move Speed Spelldance Dealing magic or true damage to champions grants Move Speed for 4 seconds."
  },
  {
   "id": 3165,
   "name": "Morellonomicon",
   "price": 2850,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3165_mage_t3_morellonomicon.png",
   "ap": 75.0,
   "mana": 0.0,
   "hp": 350.0,
   "haste": 15.0,
   "values": {
    "GrievousAmount": 0.4000000059604645,
    "GrievousDuration": 3.0
   },
   "calcs": {},
   "limitGroups": [
    "{0938f1dc}"
   ],
   "text": "75 Ability Power 350 Health 15 Ability Haste Grievous Wounds Dealing magic damage to champions applies 40% Wounds for 3 seconds."
  },
  {
   "id": 3100,
   "name": "Lich Bane",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3100_mage_t3_lichbane.png",
   "ap": 100.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 10.0,
   "values": {
    "SpellbladeCooldown": 1.5,
    "LichBaneAPValue": 0.44999998807907104,
    "SpellbladeADRatio": 0.75,
    "SheenASBuff": 0.5,
    "Cooldown": 1.5,
    "SpellBladeDuration": 10.0
   },
   "calcs": {},
   "limitGroups": [
    "{123d7d35}",
    "{8b55a7b3}"
   ],
   "text": "100 Ability Power 6% Move Speed 10 Ability Haste Spellblade After using an Ability, your next Attack deals bonus magic damage On-Hit."
  },
  {
   "id": 3128,
   "name": "Deathfire Grasp",
   "price": 2900,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3128_deathfire_grasp.png",
   "ap": 120.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 10.0,
   "values": {
    "DamageAmp": 0.15000000596046448,
    "MaxHealthDamage": 0.15000000596046448,
    "Cooldown": 90.0,
    "Duration": 4.0
   },
   "calcs": {},
   "limitGroups": [],
   "text": "120 Ability Power 10 Ability Haste Active - The Silence: Deal magic damage equal to 15% of the Target's Max Health, and then amplify damage they take by 15% for 4 seconds (90 (0s))."
  },
  {
   "id": 4628,
   "name": "Horizon Focus",
   "price": 2700,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/4628_mage_t3_horizonfocus.png",
   "ap": 75.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 25.0,
   "values": {
    "BuffDuration": 6.0,
    "SnipeRange": 600.0,
    "ItemCooldown": 30.0,
    "VisionRadius": 1400.0,
    "VisionDuration": 2.0,
    "SecondaryBuffDuration": 3.0,
    "Cooldown": 30.0,
    "DamageAmp": 0.10000000149011612
   },
   "calcs": {},
   "limitGroups": [
    "{466ecfe1}"
   ],
   "text": "75 Ability Power 25 Ability Haste Hypershot Dealing Ability damage to champions at 600 range or greater Reveals them for 6 seconds. Focus When Hypershot is triggered, Reveal all other enemy champions within 1400 range of them for 3 seconds."
  },
  {
   "id": 3152,
   "name": "Hextech Rocketbelt",
   "price": 2650,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3152_mage_t4_hextechrocketbelt.png",
   "ap": 60.0,
   "mana": 0.0,
   "hp": 350.0,
   "haste": 10.0,
   "values": {
    "Cooldown": 50.0,
    "BaseDamage": 135.0,
    "APRatio": 0.15000000596046448
   },
   "calcs": {},
   "limitGroups": [
    "{9631810e}"
   ],
   "text": "60 Ability Power 350 Health 10 Ability Haste Supersonic Dash in target direction, unleashing missiles that deal magic damage."
  },
  {
   "id": 4010,
   "name": "Bloodletter's Curse",
   "price": 2500,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/8010_bloodletterscurse.png",
   "ap": 60.0,
   "mana": 0.0,
   "hp": 350.0,
   "haste": 15.0,
   "values": {
    "ShredPerStack": 0.07500000298023224,
    "DebuffDuration": 6.0,
    "InternalCD": 0.30000001192092896,
    "MaxStacks": 4.0
   },
   "calcs": {},
   "limitGroups": [
    "{5e2859d4}",
    "Items/ItemGroups/VoidPen"
   ],
   "text": "60 Ability Power 350 Health 15 Ability Haste Vile Decay Dealing magic damage with abilities or passives to champions reduces their Magic Resist by 7.5% for 6 seconds. (Stacks 4 times)."
  },
  {
   "id": 3802,
   "name": "Lost Chapter",
   "price": 1200,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/3802_mage_tier2_lostchapter.png",
   "ap": 40.0,
   "mana": 300.0,
   "hp": 0.0,
   "haste": 10.0,
   "values": {
    "ManaRestorePercent": 0.20000000298023224,
    "RestorationDuration": 3.0
   },
   "calcs": {},
   "limitGroups": [
    "Items/ItemGroups/MythicItems"
   ],
   "text": "40 Ability Power 300 Mana 10 Ability Haste Enlighten Levelling up restores 20% max Mana over 3 seconds."
  },
  {
   "id": 1058,
   "name": "Needlessly Large Rod",
   "price": 1200,
   "icon": "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/1058_mage_t1_largerod.png",
   "ap": 65.0,
   "mana": 0.0,
   "hp": 0.0,
   "haste": 0.0,
   "values": {},
   "calcs": {},
   "limitGroups": [],
   "text": "65 Ability Power"
  }
 ],
 "augments": [
  {
   "key": "ARAM_WitchfulThinking",
   "id": 1097,
   "name": "Witchful Thinking",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/witchfulthinking_small.png",
   "values": {
    "APFlat": 70.0
   },
   "calcs": {
    "AP": {
     "lvl1": 20.0,
     "lvl18": 80.0
    }
   },
   "text": "Gain %i:scaleAP% @AP@ Ability Power."
  },
  {
   "key": "OminousPact",
   "id": 1332,
   "name": "Ominous Pact",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/wisdomofages_small.png",
   "values": {
    "MaxOmnivamp": 0.20000000298023224,
    "MSMod": 0.5,
    "SpellHealthCost": 0.05000000074505806,
    "HealthThresholdTT": 0.30000001192092896,
    "MaxLevel": 2.0
   },
   "calcs": {
    "APPerLevel": {
     "lvl1": 75.0,
     "lvl18": 150.0
    }
   },
   "text": "Gain @APPerLevel@ Ability Power, @MSMod*100@% Movement Speed, and @MaxOmnivamp*100@% Omnivamp based on missing Health. Spell casts cost @SpellHealthCost*100@% of your current Health. Max benefit at @HealthThresholdTT*100@% Health."
  },
  {
   "key": "ARAM_Goliath",
   "id": 1041,
   "name": "Goliath",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/goliath_small.png",
   "values": {
    "SizeAmp": 0.5,
    "HealthAmp": 0.3499999940395355,
    "ADAmp": 0.15000000596046448,
    "APAmp": 0.15000000596046448,
    "AFAmp": 0.15000000596046448
   },
   "calcs": {},
   "text": "Become large, gaining @HealthAmp*100@% Health and @AFAmp*100@% Adaptive Force."
  },
  {
   "key": "HandOfBaron",
   "id": 1389,
   "name": "Hand of Baron",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/handofbaron_small.png",
   "values": {
    "AFAmp": 0.25
   },
   "calcs": {},
   "text": "Gain @AFAmp*100@% Adaptive Force. Nearby allied minions are greatly empowered."
  },
  {
   "key": "ARAM_MadScientist",
   "id": 1053,
   "name": "Mad Scientist",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/madscientist_small.png",
   "values": {
    "ADAmp": 0.30000001192092896,
    "APAmp": 0.30000001192092896,
    "HealthAmp": 0.20000000298023224,
    "MovespeedAmp": 0.4000000059604645,
    "Haste": 70.0,
    "SizeAmp": 0.4000000059604645
   },
   "calcs": {},
   "text": "On each Revive, you grow large (gaining @ADAmp*100@% Adaptive Force and @HealthAmp*100@% Health) or tiny (gaining @Haste@ Ability Haste and @MovespeedAmp*100@% Movement Speed)."
  },
  {
   "key": "ARAM_ADAPt",
   "id": 1205,
   "name": "ADAPt",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/adapt_small.png",
   "values": {
    "ConversionRate": 1.666659951210022,
    "InverseRate": 0.6000000238418579,
    "APAmp": 0.15000000596046448
   },
   "calcs": {},
   "text": ""
  },
  {
   "key": "ARAM_PhenomenalEvil",
   "id": 1390,
   "name": "Phenomenal Evil",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/aram_phenomenalevil_small.png",
   "values": {
    "ProcCooldown": 1.0,
    "StartingAPIfSecondAugment": 40.0,
    "APPerProc": 1.0,
    "SpellIDCD": 3.0
   },
   "calcs": {},
   "text": "Permanently gain @APPerProc@ Ability Power when you damage enemy champions with Abilities. If taken as your second Augment, starts with @StartingAPIfSecondAugment@ Ability Power. You have gained @f1@ AP. Veigar would be proud!"
  },
  {
   "key": "ARAM_MasterofDuality",
   "id": 1054,
   "name": "Master of Duality",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/masterofduality_small.png",
   "values": {
    "StackDuration": 5.0
   },
   "calcs": {
    "ADGained": {
     "lvl1": 3.0,
     "lvl18": 9.0
    },
    "APGained": {
     "lvl1": 6.0,
     "lvl18": 18.0
    }
   },
   "text": "Your Attacks grant you @APGained@ Ability Power and your Abilities that damage enemies grant you @ADGained@ Attack Damage. This buff stacks and refreshes infinitely but lasts @StackDuration@ seconds."
  },
  {
   "key": "ARAM_SlapAround",
   "id": 1136,
   "name": "Slap Around",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/slaparound_small.png",
   "values": {
    "AdaptiveForce": 10.0,
    "SpellIDCD": 5.0,
    "PercentOfStacksLost": 0.5
   },
   "calcs": {},
   "text": "Each time you Immobilize or Ground an enemy, gain a stack granting @AdaptiveForce@ Adaptive Force. Lose @PercentOfStacksLost*100@% stacks on death."
  },
  {
   "key": "MightyShield",
   "id": 1314,
   "name": "Mighty Shield",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/mightyshield_small.png",
   "values": {
    "ShieldDuration": 3.0,
    "Cooldown": 5.0
   },
   "calcs": {
    "AdaptiveAmp": {
     "lvl1": 40.0,
     "lvl18": 100.0
    }
   },
   "text": "Gain %i:miniAdaptiveForce%@AdaptiveAmp@ Adaptive Force for @ShieldDuration@ seconds when you gain a Shield (@Cooldown@ seconds Cooldown)."
  },
  {
   "key": "ARAM_ImTheJuggernaut",
   "id": 1001,
   "name": "Titan's Resolve",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/iamthejuggernaut_small.png",
   "values": {
    "Stacks_Max": 7.0,
    "Stack_Duration": 6.0,
    "StacksPerHit": 1.0,
    "MaxLevel": 2.0
   },
   "calcs": {
    "Calc_AF": {
     "lvl1": 25.0,
     "lvl18": 75.0
    },
    "Calc_Defenses": {
     "lvl1": 5.0,
     "lvl18": 10.0
    }
   },
   "text": "Dealing and receiving champion damage grants you @StacksPerHit@ stack of Juggernauting for @Stack_Duration@ seconds. For every @Stacks_Max@ stacks of Juggernauting you gain @Calc_AF@ Adaptive Force, @Calc_Defenses@ Armor, @Calc_Defenses@ Magic Resist, @Calc_Size@ Size, and @Calc_Tenacity@ Tenacity. Stacks fall off faster the more you have. Maximum Juggernauting Level: @f1.0@"
  },
  {
   "key": "ARAM_MindtoMatter",
   "id": 1056,
   "name": "Mind to Matter",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/mindtomatter_small.png",
   "values": {
    "ConvertCap": 99999.0
   },
   "calcs": {
    "ManaToHealthCalc": {
     "flat": 0,
     "manaRatio": 0.5,
     "bonusOnly": false,
     "multiplier": 1.0
    }
   },
   "text": "Gain @ManaToHealthCalc@ Health."
  },
  {
   "key": "ARAM_Overflow",
   "id": 1311,
   "name": "Overflow",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/overflow_small.png",
   "values": {
    "InitialAmpPercent": 10.0
   },
   "calcs": {
    "ManaCalc": {
     "flat": 10.0,
     "manaRatio": 0.004999999888241291,
     "bonusOnly": false,
     "multiplier": 0.009999999776482582
    }
   },
   "text": "Your Mana costs double. Your Ability Heals, Shields, and damage are @ManaCalc@ more effective."
  },
  {
   "key": "ARAM_Quest_WoogletsWitchcap",
   "id": 1156,
   "name": "Wooglet's Witchcap",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/quest_woogletswitchcap_small.png",
   "values": {},
   "calcs": {},
   "text": "Immediately gain a Needlessly Large Rod. QUEST: Possess Rabadon's Deathcap and Zhonya's Hourglass. REWARD: Gain Wooglet's Witchcap."
  },
  {
   "key": "LichBrain",
   "id": 3094,
   "name": "Lich Brain",
   "tier": "Silver",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/lichbrain_small.png",
   "values": {},
   "calcs": {},
   "text": "Gain @Calc_AP@ Ability Power."
  },
  {
   "key": "ARAM_CelestialBody",
   "id": 1013,
   "name": "Celestial Body",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/celestialbody_small.png",
   "values": {
    "Health": 1500.0,
    "DamageReduction": 0.10000000149011612
   },
   "calcs": {},
   "text": "Gain @Health@ Health, but you deal @DamageReduction*100@% less damage."
  },
  {
   "key": "DoubleTime",
   "id": 3036,
   "name": "Double Time",
   "tier": "Gold",
   "icon": "/assets/cd/latest/game/assets/ux/kiwi/augments/icons/aram_phenomenalevil_large.png",
   "values": {
    "DamageWindowSeconds": 4.0,
    "ManaGainCD": 4.0
   },
   "calcs": {
    "{aa7499cd}": {
     "flat": 0,
     "manaRatio": 0.10000000149011612,
     "bonusOnly": false,
     "multiplier": 1.0
    }
   },
   "text": "Damaging an enemy champion with 2 separate Abilities within @DamageWindowSeconds@ seconds deals @PercentOfManaDamage@ magic damage and grants @ManaGain@ %i:scaleMana% max Mana. Mana Gained: @f1@ @ManaGainCD@ second Cooldown Per Target"
  },
  {
   "key": "ARAM_Eureka",
   "id": 1030,
   "name": "Eureka",
   "tier": "Prismatic",
   "icon": "/assets/cd/latest/game/assets/ux/cherry/augments/icons/eureka_small.png",
   "values": {
    "APToHasteConversion": 0.30000001192092896
   },
   "calcs": {},
   "text": "Gain @APToHasteConversionCalc@ Ability Haste."
  }
 ]
};
