#!/usr/bin/env python3
"""Prepare a reviewed manifest update for stable upstream gateway releases."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from verify_remote_gateway import download, request_json

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "remote-gateway" / "manifest.json"
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def version_key(version: str) -> tuple[int, int, int]:
    match = VERSION_RE.fullmatch(version)
    if not match:
        raise ValueError(f"unsupported stable version: {version}")
    return tuple(int(part) for part in match.groups())


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    changed = False
    for dependency in manifest.get("dependencies", []):
        tags = request_json(
            f"https://api.github.com/repos/{dependency['repository']}/tags?per_page=100"
        )
        stable = []
        for tag in tags if isinstance(tags, list) else []:
            name = tag.get("name", "") if isinstance(tag, dict) else ""
            if VERSION_RE.fullmatch(name):
                stable.append(name)
        if not stable:
            raise RuntimeError(f"no stable upstream tags for {dependency['repository']}")
        latest = max(stable, key=version_key)
        if version_key(latest) <= version_key(dependency["version"]):
            continue

        commit_data = request_json(
            f"https://api.github.com/repos/{dependency['repository']}/commits/{latest}"
        )
        commit = commit_data.get("sha", "") if isinstance(commit_data, dict) else ""
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise RuntimeError(f"could not resolve immutable commit for {latest}")
        source_url = f"https://codeload.github.com/{dependency['repository']}/tar.gz/{commit}"
        source_sha = hashlib.sha256(download(source_url)).hexdigest()
        dependency.update(
            {
                "version": latest,
                "commit": commit,
                "source_url": source_url,
                "source_sha256": source_sha,
            }
        )
        changed = True
        print(f"prepared {dependency['id']}: {dependency['version']} {commit} {source_sha}")

    if changed:
        MANIFEST_PATH.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    else:
        print("no stable gateway dependency updates available")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, urllib.error.URLError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
