"""web/scripts/patch_day.py: which scheduled patch is due, by Pacific date (no network)."""
import importlib.util, os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("patch_day", os.path.join(HERE, "..", "..", "web", "scripts", "patch_day.py"))
patch_day = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch_day)

SCHEDULE = {"timeZone": "America/Los_Angeles", "patches": [{"patch": "26.20", "date": "2026-10-07"}, {"patch": "26.21", "date": "2026-10-21"}]}


def at(iso):
    return datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)


def test_due_patch_follows_the_pacific_calendar_day():
    assert patch_day.due_patch(SCHEDULE, at("2026-10-20T23:00:00"))["patch"] == "26.20"
    # 06:00 UTC on the 21st is still the 20th in Los Angeles
    assert patch_day.due_patch(SCHEDULE, at("2026-10-21T06:00:00"))["patch"] == "26.20"
    assert patch_day.due_patch(SCHEDULE, at("2026-10-21T08:00:00"))["patch"] == "26.21"
    assert patch_day.due_patch(SCHEDULE, at("2026-01-01T00:00:00")) is None


def test_due_patch_waits_for_the_update_time_in_pacific_time():
    timed = {**SCHEDULE, "time": "06:30", "patches": SCHEDULE["patches"] + [{"patch": "26.22", "date": "2026-11-04"}]}
    # Oct 21 is PDT (UTC-7): 6:30 there is 13:30 UTC
    assert patch_day.due_patch(timed, at("2026-10-21T13:29:00"))["patch"] == "26.20"
    assert patch_day.due_patch(timed, at("2026-10-21T13:30:00"))["patch"] == "26.21"
    # Nov 4 is PST (UTC-8): 6:30 there is 14:30 UTC
    assert patch_day.due_patch(timed, at("2026-11-04T14:29:00"))["patch"] == "26.21"
    assert patch_day.due_patch(timed, at("2026-11-04T14:30:00"))["patch"] == "26.22"


def test_schedule_names_and_game_versions_compare_across_years():
    assert patch_day.key("26.21") == patch_day.key("16.21.1") == (16, 21)
    assert patch_day.key("27.01") > patch_day.key("16.24.1")
    assert patch_day.key("16.20.8248524+branch.releases-16-20.content.release") == (16, 20)
