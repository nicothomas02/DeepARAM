"""The stats workflows check what they generated before committing (cn-stats.yml, fill.yml: "nothing is committed
when they fail"). They name test files and one test, so a rename here would make that step fail on "not found" and
hold back every stats commit: this keeps the names real, and the check right before the commit."""
import os
import re

import pytest

from deeparam_data_helpers import read, repo


def steps(workflow):
    """[(name, text)] of a workflow's steps, in order."""
    parts = re.split(r"\n      - (?:name: |uses: )", read(f".github/workflows/{workflow}"))[1:]
    return [(p.split("\n", 1)[0], p) for p in parts]


@pytest.mark.parametrize("workflow, must_run", [
    ("cn-stats.yml", ["tests/data/test_data_cn.py", "tests/data/test_aramhex_snapshot.py"]),
    ("fill.yml", ["tests/data/test_data_fill.py", "tests/data/test_data_estimates.py"]),
])
def test_stats_workflow_checks_real_tests_right_before_its_commit(workflow, must_run):
    all_steps = steps(workflow)
    names = [n for n, _ in all_steps]
    commit = names.index("Commit changes")
    name, text = all_steps[commit - 1]
    assert "nothing is committed when they fail" in name and "continue-on-error" not in text
    targets = re.findall(r"tests/data/\w+\.py(?:::\w+)?", text.split("run: |", 1)[1])
    assert set(must_run) <= set(targets)
    # The suite's own order: the data folders' scripts share module names (common.py), and some test files only
    # load after others (test_data_analysis.py fails to collect after test_data_estimates.py).
    assert targets == sorted(targets)
    for t in targets:
        path, _, test = t.partition("::")
        assert os.path.exists(repo(path)), t
        assert not test or re.search(rf"^def {test}\(", read(path), re.M), t


def test_a_failed_aramhex_download_ends_the_stats_run_red_after_its_commit():
    """cn-stats.yml: the download may fail without stopping the stats (the last copy is used and the rest is
    committed), and the job's last step then fails the run. Each part matters: without the id or continue-on-error,
    or with an `|| ...` after the command, the failure is hidden again or the stats are held back."""
    all_steps = steps("cn-stats.yml")
    names = [n for n, _ in all_steps]
    download = [t for _, t in all_steps if re.search(r"^ +run: python3 data/aramhex/fetch\.py", t, re.M)]
    assert len(download) == 1
    assert re.search(r"^ +run: python3 data/aramhex/fetch\.py$", download[0], re.M)  # nothing after it hides the exit code
    assert re.search(r"^ +continue-on-error: true$", download[0], re.M)
    step_id = re.search(r"^ +id: (\w+)$", download[0], re.M).group(1)
    commit = names.index("Commit changes")
    assert commit == len(names) - 2
    last = all_steps[commit + 1][1]
    assert re.search(rf"^ +if: steps\.{step_id}\.outcome == 'failure'$", last, re.M)
    assert re.search(r"^ +exit 1$", last, re.M) and "continue-on-error" not in last
