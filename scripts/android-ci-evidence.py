#!/usr/bin/env python3
"""Inspect downloaded build artifacts, never confuse archive size with APK bytes."""
import importlib.util
import json
import pathlib
import sys
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('size_report', pathlib.Path(__file__).with_name('android-apk-size-report.py'))
size = importlib.util.module_from_spec(spec)
spec.loader.exec_module(size)
current, baseline = map(pathlib.Path, sys.argv[1:3])
run, before = [json.load(open(p)) for p in sys.argv[3:5]]
for info in (run, before):
    if info['status'] != 'completed' or info['conclusion'] != 'success':
        raise SystemExit('Evidence requires completed successful runs')
print('## Android measured evidence\n')
print(f"Current commit: `{run['headSha']}`; baseline: `{before['headSha']}`.\n")
print('| Build | APK | Exact bytes | Decimal MB | Target |\n|---|---|---:|---:|---|')
for label, directory in [('Baseline', baseline), ('Current', current)]:
    apks = sorted(directory.rglob('*.apk'))
    if not apks:
        raise SystemExit(f'{label}: no APK found')
    for apk in apks:
        n = apk.stat().st_size
        if not n:
            raise SystemExit(f'{apk}: empty APK')
        print(f'| {label} | {apk.name} | {n} | {n / 1_000_000:.6f} | {"PASS" if n <= size.TARGET_BYTES else "PARTIAL"} |')
print('\n### Current APK inventories\n')
for apk in sorted(current.rglob('*.apk')):
    print('\n'.join(size.render_artifact(size.analyze_zip(str(apk)))))
print('\n### Android reports\n')
reports = sorted(current.rglob('lint-results*.xml'))
for report in reports:
    root = ET.parse(report).getroot()
    issues = root.findall('issue')
    errors = [i for i in issues if i.get('severity') in ('Error', 'Fatal')]
    print(f'- `{report.relative_to(current)}`: {len(errors)} errors/fatal, {len(issues)-len(errors)} other issues.')
    for issue in errors:
        print(f'  - {issue.get("id")}: {issue.get("message")}')
# HTML test reports expose totals even when upload excludes test-results XML.
import re
for index in sorted(current.rglob('tests/testDebugUnitTest/index.html')):
    text = index.read_text()
    counts = re.findall(r'<div class="counter">([^<]+)</div>', text)
    print(f'- `{index.relative_to(current)}` counters (tests/failures/ignored): {counts[:3]}')
if not reports:
    print('- BLOCKED: lint XML not present in downloaded reports; job completion alone is not a zero-errors claim.')
