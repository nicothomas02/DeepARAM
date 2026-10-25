# Restoring DeepARAM from these backups

Backups live on Nico's Mac in `~/Developer/DeepARAM-backups/`, one folder per patch release
(`<date>-<patch>`), made by `tools/backup/backup.py`. Each folder has:

- `repo.bundle` (or `repo.bundle.part001`, `.part002`, ...): the repo's commits on every branch and tag
  that the earlier backups didn't already hold.
- `project-files.tar.gz` (or parts): the project's shared folder, only files new or changed since the
  previous backup. `MANIFEST.json` lists files removed since then.
- `d1/<database>.sql`: a full dump of each D1 database (schema and rows). Sign-in sessions and one-time
  link codes are left out, since they expire anyway.
- `MANIFEST.json`: the patch, the branch and tag tips at the time, and what each part holds.

The repo and shared-folder parts are incremental, so restore them by replaying every folder oldest first.
The first backup's repo bundle builds on the Mac's own clone in `~/Developer/ARAM-Mayhem` (its
`MANIFEST.json` lists those commits under `prerequisites`), so keep that clone, or start from it.

## Joining split parts

```sh
cat repo.bundle.part* > repo.bundle
cat project-files.tar.gz.part* > project-files.tar.gz
```

## The repo

```sh
git clone ~/Developer/ARAM-Mayhem DeepARAM-restored && cd DeepARAM-restored
for b in ~/Developer/DeepARAM-backups/*/repo.bundle; do
  git bundle verify "$b" && git fetch "$b" 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*' --update-head-ok
done
git remote set-url origin https://github.com/nicothomas02/DeepARAM.git   # or a new empty repo
git push origin --all && git push origin --tags
```

## The shared folder

```sh
mkdir project-files && for t in ~/Developer/DeepARAM-backups/*/project-files.tar.gz; do tar -xzf "$t" -C project-files; done
```

Then delete the files the newest `MANIFEST.json` lists under `project_files.removed`, and upload the
folder's contents back into the project.

## The databases

Create an empty database of the same name if it's gone, then load the newest dump:

```sh
cd web
npx wrangler d1 execute deeparam-profiles --remote --file ~/Developer/DeepARAM-backups/<newest>/d1/deeparam-profiles.sql
```

Same for `deeparam-games`, `deeparam-sim` and `deeparam-errors`. If a database was recreated, put its new
id in `web/wrangler.jsonc`. For a mistake in the last 7 days (30 on the paid Workers plan), Cloudflare's own D1 Time Travel
(`npx wrangler d1 time-travel restore <name> --timestamp <ISO time>`) is quicker.

## Copies on GitHub

When the repo secrets `CLOUDFLARE_API_TOKEN` (with D1 access) and `BACKUP_PASSPHRASE` are set, the
"Backup" workflow also attaches an encrypted database export to a `backup-<date>` pre-release on each
patch day. Decrypt it with:

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in d1-backup.tar.gz.enc -out d1-backup.tar.gz
```
