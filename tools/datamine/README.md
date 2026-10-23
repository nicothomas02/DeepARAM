# Mayhem PBE datamine

Scripts that compare PBE against live client data and pull out what affects
ARAM: Mayhem. Results are written up by hand in `data/pbe/`.

Get the data from CommunityDragon. It writes `DIR/pbe` and `DIR/latest`:

```sh
python3 -m pip install xxhash
python3 tools/datamine/fetch.py /tmp/dm          # ~100 MB: PBE + live files
```

Then:

```sh
python3 tools/datamine/augments.py /tmp/dm       # Mayhem augment pool diff
python3 tools/datamine/champions.py /tmp/dm      # champion changes
python3 tools/datamine/icons.py /tmp/dm          # add augment icons (and changed-augment tiers) to kiwi-s3.json
```

- `jsondiff.py`: structural diff of two bin.json files (also used for kiwi.bin, map12.bin, items).
- `strings.py`: string-table lookup (keys are 38-bit xxh3 hashes of the lowercase key).

For `fetch.py`, the cloud environment needs `raw.communitydragon.org` in its allowed domains.
