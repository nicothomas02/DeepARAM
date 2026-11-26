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
