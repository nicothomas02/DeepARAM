"""Hand-kept map of each champion's official subclass, using Riot's class and subclass definitions.

The game files only carry the six broad roles (Fighter, Tank, Mage, Assassin, Marksman, Support). Riot's finer
subclasses aren't in any client file, so they're kept here by hand. Add new champions when they ship; a champion
missing from SUBCLASS gets its role only.
"""

# Riot's classes, each with its subclasses, and what each subclass means
CLASSES = {
    "Controller": {"Enchanter": "Strengthens allies with heals, shields and buffs.",
                   "Catcher": "Locks down enemies who walk into their traps and hooks."},
    "Fighter": {"Juggernaut": "Slow, hard to kill and hits hard up close.",
                "Diver": "Jumps onto a target and stays on them."},
    "Mage": {"Burst": "Deletes one target with a quick combo.",
             "Battlemage": "Stays in the fight and deals damage over time.",
             "Artillery": "Hits from very long range."},
    "Marksman": {"Marksman": "Steady damage from range with basic attacks."},
    "Slayer": {"Assassin": "Gets in, kills a squishy target, gets out.",
               "Skirmisher": "Wins long close-range fights with strong duelling."},
    "Tank": {"Vanguard": "Starts fights by diving in with crowd control.",
             "Warden": "Protects allies and peels for them."},
    "Specialist": {"Specialist": "Plays unlike any other class."},
}

# alias: subclass, or (subclass, second subclass)
SUBCLASS = {
    "Aatrox": "Juggernaut", "Ahri": "Burst", "Akali": "Assassin", "Akshan": ("Marksman", "Assassin"),
    "Alistar": "Vanguard", "Ambessa": "Diver", "Amumu": "Vanguard", "Anivia": "Battlemage", "Annie": "Burst",
    "Aphelios": "Marksman", "Ashe": ("Marksman", "Catcher"), "AurelionSol": "Battlemage", "Aurora": "Burst",
    "Azir": "Specialist", "Bard": "Catcher", "Belveth": "Skirmisher", "Blitzcrank": "Catcher", "Brand": "Burst",
    "Braum": "Warden", "Briar": "Diver", "Caitlyn": "Marksman", "Camille": "Diver", "Cassiopeia": "Battlemage",
    "Chogath": "Specialist", "Corki": ("Marksman", "Artillery"), "Darius": "Juggernaut", "Diana": ("Diver", "Burst"),
    "DrMundo": "Juggernaut", "Draven": "Marksman", "Ekko": "Assassin", "Elise": "Burst", "Evelynn": "Assassin",
    "Ezreal": ("Marksman", "Artillery"), "FiddleSticks": "Specialist", "Fiora": "Skirmisher", "Fizz": "Assassin",
    "Galio": "Warden", "Gangplank": "Specialist", "Garen": "Juggernaut", "Gnar": "Specialist", "Gragas": "Vanguard",
    "Graves": "Specialist", "Gwen": "Skirmisher", "Hecarim": "Diver", "Heimerdinger": "Specialist",
    "Hwei": ("Artillery", "Burst"), "Illaoi": "Juggernaut", "Irelia": "Diver", "Ivern": "Enchanter",
    "Janna": "Enchanter", "JarvanIV": "Diver", "Jax": "Skirmisher", "Jayce": "Artillery", "Jhin": ("Marksman", "Catcher"),
    "Jinx": "Marksman", "KSante": "Warden", "Kaisa": "Marksman", "Kalista": "Marksman", "Karma": "Enchanter",
    "Karthus": "Battlemage", "Kassadin": "Assassin", "Katarina": "Assassin", "Kayle": "Specialist",
    "Kayn": ("Skirmisher", "Assassin"), "Kennen": "Specialist", "Khazix": "Assassin", "Kindred": "Marksman",
    "Kled": "Diver", "KogMaw": "Marksman", "Leblanc": "Burst", "LeeSin": "Diver", "Leona": "Vanguard",
    "Lillia": "Specialist", "Lissandra": "Burst", "Lucian": "Marksman", "Lulu": "Enchanter", "Lux": "Burst",
    "Malphite": "Vanguard", "Malzahar": "Battlemage", "Maokai": "Vanguard", "MasterYi": "Skirmisher",
    "Milio": "Enchanter", "MissFortune": "Marksman", "Mordekaiser": "Juggernaut", "Morgana": "Catcher",
    "Naafiri": "Assassin", "Nami": "Enchanter", "Nasus": "Juggernaut", "Nautilus": "Vanguard", "Neeko": "Burst",
    "Nidalee": "Specialist", "Nilah": "Skirmisher", "Nocturne": "Assassin", "Nunu": "Vanguard", "Olaf": "Diver",
    "Orianna": "Burst", "Ornn": "Vanguard", "Pantheon": "Diver", "Poppy": "Warden", "Pyke": ("Catcher", "Assassin"),
    "Qiyana": "Assassin", "Quinn": "Specialist", "Rakan": "Catcher", "Rammus": "Vanguard", "RekSai": "Diver",
    "Rell": "Vanguard", "Renata": "Enchanter", "Renekton": "Diver", "Rengar": "Assassin", "Riven": "Skirmisher",
    "Rumble": "Battlemage", "Ryze": "Battlemage", "Samira": "Marksman", "Sejuani": "Vanguard",
    "Senna": ("Marksman", "Enchanter"), "Seraphine": "Enchanter", "Sett": "Juggernaut", "Shaco": "Assassin",
    "Shen": "Warden", "Shyvana": "Juggernaut", "Singed": "Specialist", "Sion": "Vanguard", "Sivir": "Marksman",
    "Skarner": "Vanguard", "Smolder": "Marksman", "Sona": "Enchanter", "Soraka": "Enchanter", "Swain": "Battlemage",
    "Sylas": "Skirmisher", "Syndra": "Burst", "TahmKench": "Warden", "Taliyah": "Battlemage", "Talon": "Assassin",
    "Taric": "Warden", "Teemo": "Specialist", "Thresh": "Catcher", "Tristana": "Marksman", "Trundle": "Juggernaut",
    "Tryndamere": "Skirmisher", "TwistedFate": "Burst", "Twitch": "Marksman", "Udyr": "Juggernaut",
    "Urgot": "Juggernaut", "Varus": ("Marksman", "Artillery"), "Vayne": "Marksman", "Veigar": "Burst",
    "Velkoz": "Artillery", "Vex": "Burst", "Vi": "Diver", "Viego": "Skirmisher", "Viktor": "Battlemage",
    "Vladimir": "Battlemage", "Volibear": "Juggernaut", "Warwick": "Diver", "MonkeyKing": "Diver", "Xayah": "Marksman",
    "Xerath": "Artillery", "XinZhao": "Diver", "Yasuo": "Skirmisher", "Yone": "Skirmisher", "Yorick": "Juggernaut",
    "Yuumi": "Enchanter", "Zac": "Vanguard", "Zed": "Assassin", "Zeri": "Marksman", "Ziggs": "Artillery",
    "Zilean": "Specialist", "Zoe": "Burst", "Zyra": "Catcher",
}

CLASS_OF = {sub: cls for cls, subs in CLASSES.items() for sub in subs}
