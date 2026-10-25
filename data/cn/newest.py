#!/usr/bin/env python3
"""Has Tencent published a day newer than the one in champions.json?

The stats are per Beijing day and appear once that day is over, so the hourly "Mayhem stats" job runs this first
and only does the full refresh when it answers yes. Prints GitHub step outputs:
  new=true|false   day=YYYYMMDD (the newest published Beijing day)

Usage: python3 data/cn/newest.py
"""

import datetime as dt
import json
import os
import sys

from fetch_cn import odp

OUT = os.path.dirname(os.path.abspath(__file__))
BEIJING = dt.timezone(dt.timedelta(hours=8))


def main():
    with open(os.path.join(OUT, "champions.json"), encoding="utf-8") as f:
        have = json.load(f).get("meta", {}).get("champion_stat_date", "")
    yesterday = dt.datetime.now(BEIJING).date() - dt.timedelta(days=1)
    day = yesterday.strftime("%Y%m%d")
    new = False
    if day > have:
        try:
            _, payload = odp("fuwen_aram_hero_rank_v2", {"dtstatdate": day})
            new = bool(isinstance(payload, dict) and payload.get("listcollect"))
        except OSError as e:  # unreachable for now: the next hourly run asks again
            print(f"::warning::{e}", file=sys.stderr)
    print(f"new={'true' if new else 'false'}")
    print(f"day={day if new else have}")


if __name__ == "__main__":
    main()
