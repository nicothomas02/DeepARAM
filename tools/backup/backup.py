"""Patch-release backups of the repo, the project's shared folder and the databases.

Each backup is a folder of plain files (see RESTORE.md next to this script) that ends up on Nico's Mac in
~/Developer/DeepARAM-backups/<date>-<patch>/. To keep that small, the repo and the shared folder are
incremental: the first backup holds everything, later ones only what changed since the one before, so a
restore replays them in order. A state file remembers what the last backup held.

  prepare  Clone the repo, bundle new commits, pack changed shared files, write MANIFEST.json and a
           pending state. Big files are split into parts small enough to copy one by one.
  d1-query Print the SELECT that turns one D1 table into INSERT statements, for dumping a database
           through a read-only query tool.
  finish   After the folder is safely copied, make its pending state the current one.

Usage:
  python3 tools/backup/backup.py prepare --out DIR --state STATE.json --patch 26.21 \
      [--repo URL_OR_PATH] [--files /mnt/project-files/] [--base-tips FILE]
  python3 tools/backup/backup.py d1-query TABLE COL [COL ...]
  python3 tools/backup/backup.py finish --out DIR --state STATE.json
"""
import argparse, hashlib, json, os, shutil, subprocess, tarfile, tempfile
from datetime import datetime, timezone

REPO_URL = "https://github.com/nicothomas02/DeepARAM.git"
PART = 25 * 1024 * 1024  # the copy to the Mac takes files up to 30 MB
SKIP_DIRS = {"backups", ".git", "__pycache__", "node_modules"}


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def tips(mirror):
    """Every branch and tag tip, as {ref: sha}. Pull request refs are left out."""
    out = git("for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags", cwd=mirror)
    return dict(line.split(" ", 1) for line in out.splitlines() if line)


def bundle_repo(mirror, known, dest):
    """Bundle every commit on a branch or tag that isn't reachable from `known` (shas the backups already
    hold). Returns the number of new commits; writes nothing when there are none."""
    have = [sha for sha in known if subprocess.run(["git", "cat-file", "-e", sha + "^{commit}"], cwd=mirror,
                                                     capture_output=True).returncode == 0]
    new = int(git("rev-list", "--count", "--branches", "--tags", *("^" + s for s in have), cwd=mirror).strip())
    if new == 0:
        return 0
    git("bundle", "create", dest, "--branches", "--tags", *("^" + s for s in have), cwd=mirror)
    return new


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def scan(root):
    """{relative path: sha256} for every file under root, skipping the backups staging folder."""
    found = {}
    for here, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(files):
            full = os.path.join(here, name)
            if os.path.isfile(full) and not os.path.islink(full):
                found[os.path.relpath(full, root)] = sha256(full)
    return found


def pack_files(root, before, dest):
    """Tar the files that are new or changed since `before`. Returns (now, changed, removed)."""
    now = scan(root)
    changed = [p for p, h in now.items() if before.get(p) != h]
    removed = sorted(p for p in before if p not in now)
    if changed:
        with tarfile.open(dest, "w:gz") as tar:
            for p in changed:
                tar.add(os.path.join(root, p), arcname=p)
    return now, changed, removed


def split_big(path):
    """Split a file over PART bytes into path.part001, path.part002, ... and return the part names."""
    if os.path.getsize(path) <= PART:
        return [os.path.basename(path)]
    names = []
    with open(path, "rb") as f:
        for i, block in enumerate(iter(lambda: f.read(PART), b""), 1):
            name = f"{os.path.basename(path)}.part{i:03d}"
            with open(os.path.join(os.path.dirname(path), name), "wb") as out:
                out.write(block)
            names.append(name)
    os.remove(path)
    return names


def load_state(path):
    if path and os.path.exists(path):
        return json.load(open(path))
    return {"backups": [], "repo_tips": [], "files": {}}


def prepare(args):
    state = load_state(args.state)
    os.makedirs(os.path.join(args.out, "d1"), exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {"created": stamp, "patch": args.patch, "previous": state["backups"][-1] if state["backups"] else None}

    known = list(state["repo_tips"])
    if args.base_tips:  # commits the Mac's own clone already holds count as backed up
        known += [l.split()[0] for l in open(args.base_tips) if l.strip()]
    work = tempfile.mkdtemp(prefix="backup-repo-")
    try:
        mirror = os.path.join(work, "mirror.git")
        git("clone", "--quiet", "--mirror", args.repo, mirror)
        refs = tips(mirror)
        bundle = os.path.join(args.out, "repo.bundle")
        new = bundle_repo(mirror, known, bundle)
        manifest["repo"] = {"new_commits": new, "refs": refs,
                            "prerequisites": sorted(set(known)),
                            "parts": split_big(bundle) if new else []}
    finally:
        shutil.rmtree(work, ignore_errors=True)

    tar = os.path.join(args.out, "project-files.tar.gz")
    now, changed, removed = pack_files(args.files, state["files"], tar)
    manifest["project_files"] = {"changed": len(changed), "removed": removed, "total": len(now),
                                 "parts": split_big(tar) if changed else []}

    pending = {"backups": state["backups"] + [os.path.basename(os.path.normpath(args.out))],
               "repo_tips": sorted(set(state["repo_tips"]) | set(refs.values())), "files": now}
    json.dump(pending, open(os.path.join(args.out, "pending-state.json"), "w"), indent=1, sort_keys=True)
    json.dump(manifest, open(os.path.join(args.out, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
    shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), "RESTORE.md"), args.out)
    print(f"repo: {new} new commits; shared folder: {len(changed)} changed, {len(removed)} removed")


def finish(args):
    pending = os.path.join(args.out, "pending-state.json")
    os.makedirs(os.path.dirname(os.path.abspath(args.state)), exist_ok=True)
    shutil.move(pending, args.state)
    print("state saved:", json.load(open(args.state))["backups"][-1])


def d1_query(args):
    """A SELECT whose single text value is the table as INSERT statements, one per line."""
    cols = ", ".join(f'"{c}"' for c in args.columns)
    vals = " || ',' || ".join(f'quote("{c}")' for c in args.columns)
    print(f"SELECT group_concat('INSERT INTO \"{args.table}\" ({cols}) VALUES (' || {vals} || ');', char(10)) "
          f"AS sql FROM \"{args.table}\"")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--out", required=True)
    p.add_argument("--state", required=True)
    p.add_argument("--patch", required=True)
    p.add_argument("--repo", default=REPO_URL)
    p.add_argument("--files", default="/mnt/project-files/")
    p.add_argument("--base-tips", help="file of commit shas (one per line) that are already backed up elsewhere")
    f = sub.add_parser("finish")
    f.add_argument("--out", required=True)
    f.add_argument("--state", required=True)
    q = sub.add_parser("d1-query")
    q.add_argument("table")
    q.add_argument("columns", nargs="+")
    args = ap.parse_args(argv)
    {"prepare": prepare, "finish": finish, "d1-query": d1_query}[args.cmd](args)


if __name__ == "__main__":
    main()
