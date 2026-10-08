#!/usr/bin/env python3
"""android-apk-size-report.py — measure and break down Android build artifacts.

This is the size-audit harness behind docs/ANDROID_SIZE_AUDIT.md. It is pure
stdlib so it runs identically on a developer machine and in GitHub Actions:

    python3 scripts/android-apk-size-report.py app-debug.apk app-release.apk app-release.aab

For every artifact it reports:

  * exact byte size (plus MB / MiB so "30 MB" can never be ambiguous),
  * a compressed-size breakdown by contributor class (dex, resources.arsc,
    res/, lib/, assets/, META-INF, kotlin metadata, other),
  * the largest individual zip entries,
  * native-library inventory (per-ABI .so counts — this project intentionally
    ships ZERO native libraries),
  * hygiene checks: bundled fonts, bundled JSON/raw data, product-image
    payloads, duplicate zip entries,
  * the <= 30 MB acceptance target verdict per artifact.

AABs additionally get a per-module split summary (base/dex/locales/density/
abi) so the difference between the universal APK and what a device actually
downloads through Play delivery can be reasoned about.

The script never mutates its inputs and exits non-zero only when an input file
is missing or unreadable — a size ABOVE target is reported as `ABOVE TARGET`
in the report but does not fail the build by itself.
"""

from __future__ import annotations

import os
import sys
import zipfile
from collections import defaultdict

TARGET_BYTES = 30_000_000  # "30 MB", decimal — the acceptance threshold from the task.


def human_mb(n: int) -> str:
    return f"{n / 1_000_000:.2f} MB ({n / (1024 * 1024):.2f} MiB)"


def normalize(name: str) -> str:
    """Strip an AAB module/kind prefix (base/dex/, base/lib/, …) so an entry is
    classified the same way whether it comes from an APK or an AAB."""
    parts = name.split("/")
    kinds = {"dex", "res", "lib", "assets", "manifest", "root", "locales", "density"}
    if len(parts) >= 3 and parts[1] in kinds:
        if parts[1] in {"dex", "manifest", "root", "locales", "density"}:
            return "/".join(parts[1:])
        return "/".join(parts[1:])
    return name


def category(name: str) -> str:
    name = normalize(name)
    if (name.startswith("classes") and name.endswith(".dex")) or name.startswith("dex/"):
        return "classes.dex (code)"
    if name.endswith("resources.arsc") or name.endswith("resources.pb"):
        return "resources.arsc"
    if name.startswith("lib/"):
        return "lib/ (native .so)"
    if name.startswith("assets/"):
        return "assets/"
    if name.startswith("res/"):
        if "font" in name.split("/")[1:2]:
            return "res/font (bundled fonts)"
        return "res/ (resources)"
    if name.startswith("META-INF/") or name.startswith("BUNDLE-METADATA/"):
        return "META-INF/ (signing + metadata)"
    if name.startswith("kotlin/"):
        return "kotlin/ (metadata)"
    return "other (manifest, xml, …)"


def analyze_zip(path: str) -> dict:
    info = {"path": path, "entries": [], "missing": False}
    if not os.path.isfile(path):
        info["missing"] = True
        return info
    info["size"] = os.path.getsize(path)
    with zipfile.ZipFile(path) as zf:
        entries = []
        seen = defaultdict(int)
        for zi in zf.infolist():
            if zi.is_dir():
                continue
            seen[zi.filename] += 1
            entries.append(
                {
                    "name": zi.filename,
                    "compressed": zi.compress_size,
                    "raw": zi.file_size,
                }
            )
        info["entries"] = entries
        info["duplicates"] = sorted(n for n, c in seen.items() if c > 1)
    return info


def render_artifact(info: dict) -> list[str]:
    out: list[str] = []
    name = os.path.basename(info["path"])
    out.append(f"### `{name}`")
    if info["missing"]:
        out.append("")
        out.append("**MISSING** — file not found, nothing measured.")
        return out

    size = info["size"]
    out.append("")
    out.append(f"- exact size: **{size:,} bytes** — {human_mb(size)}")
    verdict = "PASS — artifact <= 30 MB" if size <= TARGET_BYTES else "ABOVE TARGET — artifact > 30 MB"
    out.append(f"- 30 MB acceptance target: **{verdict}**")
    out.append("")

    by_cat: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])  # compressed, raw, count
    for e in info["entries"]:
        cat = by_cat[category(e["name"])]
        cat[0] += e["compressed"]
        cat[1] += e["raw"]
        cat[2] += 1

    out.append("Largest contributors (compressed size inside the artifact):")
    out.append("")
    out.append("| contributor | compressed | uncompressed | entries |")
    out.append("| --- | ---: | ---: | ---: |")
    for cat, (comp, raw, count) in sorted(by_cat.items(), key=lambda kv: -kv[1][0]):
        out.append(f"| {cat} | {comp:,} | {raw:,} | {count} |")
    out.append("")

    top = sorted(info["entries"], key=lambda e: -e["compressed"])[:15]
    out.append("Top 15 individual entries:")
    out.append("")
    out.append("| entry | compressed | uncompressed |")
    out.append("| --- | ---: | ---: |")
    for e in top:
        out.append(f"| `{e['name']}` | {e['compressed']:,} | {e['raw']:,} |")
    out.append("")

    so_abis: dict[str, int] = defaultdict(int)
    norm_entries = [(normalize(e["name"]), e) for e in info["entries"]]
    fonts = [e for n, e in norm_entries if "/font/" in n or n.endswith((".ttf", ".otf"))]
    jsons = [
        e
        for n, e in norm_entries
        if n.endswith(".json") and not n.startswith("META-INF") and not n.startswith("BUNDLE-METADATA")
    ]
    images = [
        e
        for n, e in norm_entries
        if (n.startswith("res/") or n.startswith("density/") or n.startswith("root/"))
        and n.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
    ]
    for n, _ in norm_entries:
        if n.startswith("lib/") and n.endswith(".so"):
            parts = n.split("/")
            if len(parts) > 2:
                so_abis[parts[1]] += 1

    out.append("Hygiene checks:")
    out.append("")
    if so_abis:
        out.append(f"- native libraries: {sum(so_abis.values())} .so — ABIs: {dict(sorted(so_abis.items()))}")
    else:
        out.append("- native libraries: **0 .so files** — no ABI split is needed; one APK serves every ABI")
    out.append(f"- bundled font files: {len(fonts)}")
    out.append(f"- bundled JSON/raw data files (non-META-INF): {len(jsons)}"
               + ("" if not jsons else f" — e.g. `{jsons[0]['name']}`"))
    img_bytes = sum(e["compressed"] for e in images)
    out.append(f"- raster images under res/: {len(images)} files, {img_bytes:,} bytes compressed in-artifact")
    if info["duplicates"]:
        out.append(f"- duplicate zip entries: {info['duplicates']}")
    else:
        out.append("- duplicate zip entries: none")
    out.append("")
    return out


def render_aab_splits(path: str) -> list[str]:
    out: list[str] = []
    if not os.path.isfile(path):
        return out
    out.append("AAB split inventory (what Play can deliver separately):")
    out.append("")
    with zipfile.ZipFile(path) as zf:
        by_kind: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for zi in zf.infolist():
            if zi.is_dir():
                continue
            parts = zi.filename.split("/")
            if len(parts) >= 3 and parts[1] in {"dex", "res", "lib", "assets", "manifest", "root", "locales", "density"}:
                kind = f"{parts[0]}/{parts[1]}/"
                if parts[1] == "lib" and len(parts) >= 4:
                    kind = f"{parts[0]}/lib/{parts[2]}/"
                if parts[1] == "locales" and len(parts) >= 4:
                    kind = f"{parts[0]}/locales/{parts[2]}/"
            else:
                kind = parts[0] + "/"
            by_kind[kind][0] += zi.compress_size
            by_kind[kind][1] += 1
        for kind, (comp, count) in sorted(by_kind.items(), key=lambda kv: -kv[1][0]):
            out.append(f"- `{kind}` — {comp:,} compressed, {count} entries")
    out.append("")
    out.append(
        "A universal APK is what `assembleRelease` produces; a device downloading this "
        "AAB from Play receives only its ABI/density/language slices — strictly less "
        "than the numbers above."
    )
    out.append("")
    out.append("Estimated per-device delivery (base code + resources + ONE ABI slice; density/locale splits shrink this further):")
    out.append("")
    with zipfile.ZipFile(path) as zf:
        entries = [zi for zi in zf.infolist() if not zi.is_dir()]
        fixed = sum(
            zi.compress_size
            for zi in entries
            if "/lib/" not in zi.filename
            and not zi.filename.startswith("BUNDLE-METADATA")
        )
        abis: dict[str, int] = defaultdict(int)
        for zi in entries:
            parts = zi.filename.split("/")
            if len(parts) >= 4 and parts[1] == "lib":
                abis[parts[2]] += zi.compress_size
        for abi, comp in sorted(abis.items()):
            out.append(f"- ~{(fixed + comp) / 1_000_000:.2f} MB to an **{abi}** device ({comp:,} bytes of native code)")
        if not abis:
            out.append(f"- ~{fixed / 1_000_000:.2f} MB to any device (no native code)")
    out.append("")
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    out: list[str] = ["## Android artifact size report", ""]
    out.append(f"Acceptance threshold: {TARGET_BYTES:,} bytes = 30 MB (decimal).")
    out.append("")
    failed = False
    for path in argv[1:]:
        info = analyze_zip(path)
        if info["missing"]:
            failed = True
        out.extend(render_artifact(info))
        if path.endswith(".aab") and not info["missing"]:
            out.extend(render_aab_splits(path))
    report = "\n".join(out)
    print(report)
    summary_path = os.environ.get("SIZE_REPORT_PATH")
    if summary_path:
        with open(summary_path, "w", encoding="utf-8") as fh:
            fh.write(report + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
