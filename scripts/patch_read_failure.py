#!/usr/bin/env python3
"""Patch one page at a time so a bad anchor cannot silently drop or abort others.

usage: patch_read_failure.py SPEC.json
SPEC: [{"path":..., "import_anchor":..., "pairs":[[old,new],...]}]
Each file is processed independently; a failure is reported and skipped.
"""
import json
import sys

IMPORT = "import { ReadFailureNotice } from '@/components/ui/read-failure-notice';"

spec = json.load(open(sys.argv[1]))
ok, bad = [], []
for entry in spec:
    path = entry['path']
    try:
        s = open(path).read()
        for old, new in entry['pairs']:
            if old not in s:
                raise AssertionError(f'{path}: missing anchor -> {old[:100]!r}')
            s = s.replace(old, new, 1)
        if "<ReadFailureNotice" in s and IMPORT not in s:
            anchor = entry['import_anchor']
            if anchor not in s:
                raise AssertionError(f'{path}: import anchor -> {anchor!r}')
            s = s.replace(anchor, anchor + '\n' + IMPORT, 1)
        open(path, 'w').write(s)
        ok.append(path)
    except Exception as exc:  # keep going: one bad spec must not hide the rest
        bad.append(str(exc))

for p in ok:
    print('ok   ', p)
for b in bad:
    print('FAIL ', b)
sys.exit(1 if bad else 0)
