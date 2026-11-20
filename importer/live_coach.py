"""Live coach for the site owner only: the chance to win the game in progress, and when a surrender pays off.

Shown in its own window (http://127.0.0.1:<port>/coach.html, from the helper), never drawn over the game. Riot's
rules don't let apps draw conclusions for players during a game, so this stays private: the helper computes it only
when the site confirms that this Riot account is connected to the owner account (the same check as "Save my games
to my account"). Everyone else gets the after-game review instead.

Inputs are only what League's Live Client Data API reports (allgamedata) and each champion's expected win rate from
the site's public /data/team-fit.json. The model is a logistic fit on the owner's 1,206 archived games with timelines
(965 to fit, 241 held out: 68% right at minute 8, 77% at 14, 81% from 20; calibrated):

    x = [1, comp*10, kills/5, towers, levels/5, kills/5*min/10, towers*min/10, levels/5*min/10]

kills, towers (turrets and inhibitors destroyed) and levels are ally minus enemy; comp is the sum of the allies'
expected win rates minus 50% minus the same for the enemies. Surrender pays off when the chance is below what the
remaining minutes are worth in a new game (about 1.4 wins an hour): FF_LINE, minute -> chance.
"""
from __future__ import annotations

import math

WEIGHTS = (0.0, 0.32, 0.184, 0.465, 0.254, -0.056, -0.019, 0.285)
FF_LINE = ((8, 0.20), (10, 0.16), (12, 0.12), (14, 0.09), (16, 0.055))
FF_HOLD = 60  # seconds under the line before the hint shows, so one lost fight doesn't trigger it


def alias(player):
    raw = player.get("rawChampionName") or ""
    return raw.removeprefix("game_character_displayname_") or player.get("championName") or ""


def _riot_id(p):
    return p.get("riotId") or p.get("summonerName") or ""


def team_of_structure(name):
    """'Turret_T1_C_05_A' / 'Barracks_T2_L1' -> the team that owned it (ORDER for T1, CHAOS for T2)."""
    if "_T1_" in name or name.endswith("_T1"):
        return "ORDER"
    if "_T2_" in name or name.endswith("_T2"):
        return "CHAOS"
    return None


def features(data, strengths):
    """(minute, my team, x vector) from one allgamedata response; None before the players load."""
    players = data.get("allPlayers") or []
    me = _riot_id(data.get("activePlayer") or {})
    mine = next((p for p in players if _riot_id(p) == me), None)
    if not mine or not mine.get("team"):
        return None
    ally = mine["team"]
    sign = lambda p: 1 if p.get("team") == ally else -1
    kills = sum(sign(p) * ((p.get("scores") or {}).get("kills") or 0) for p in players)
    levels = sum(sign(p) * (p.get("level") or 0) for p in players)
    comp = sum(sign(p) * (strengths.get(alias(p), 0.5) - 0.5) for p in players)
    towers = 0
    for e in (data.get("events") or {}).get("Events") or []:
        if e.get("EventName") in ("TurretKilled", "InhibKilled"):
            owner = team_of_structure(e.get("TurretKilled") or e.get("InhibKilled") or "")
            if owner:
                towers += 1 if owner != ally else -1
    minute = (data.get("gameData") or {}).get("gameTime", 0) / 60
    k, tw, lv = kills / 5, towers, levels / 5
    return minute, ally, (1.0, comp * 10, k, tw, lv, k * minute / 10, tw * minute / 10, lv * minute / 10)


def win_chance(x):
    z = sum(w * v for w, v in zip(WEIGHTS, x))
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def ff_line(minute):
    """The chance below which surrendering saves time; None before minute 8 (too early to tell)."""
    if minute < FF_LINE[0][0]:
        return None
    for (m0, p0), (m1, p1) in zip(FF_LINE, FF_LINE[1:]):
        if minute <= m1:
            return p0 + (p1 - p0) * (minute - m0) / (m1 - m0)
    return FF_LINE[-1][1]


class Coach:
    """Keeps one game's chance over time and whether the surrender hint is on."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.history = []  # [[game seconds, chance]]
        self.under_since = None

    def update(self, data, strengths):
        f = features(data, strengths)
        if f is None:
            return None
        minute, _, x = f
        p = win_chance(x)
        t = round(minute * 60, 1)
        if not self.history or t - self.history[-1][0] >= 5:
            self.history.append([t, round(p, 3)])
        line = ff_line(minute)
        if line is not None and p < line:
            self.under_since = t if self.under_since is None else self.under_since
        else:
            self.under_since = None
        return {
            "minute": round(minute, 2), "win": round(p, 3), "ffLine": None if line is None else round(line, 3),
            "ffHint": self.under_since is not None and t - self.under_since >= FF_HOLD,
            "history": self.history,
        }
