#!/usr/bin/env python3
"""Verify pinned BetterDesk RDP/VNC gateway sources and license gates.

This script intentionally never updates the manifest. CI can report upstream
updates, but changing a dependency requires a reviewed pull request.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "remote-gateway" / "manifest.json"
AUDIT_PATH = ROOT / "remote-gateway" / "license-audit.json"
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


class VerificationError(RuntimeError):
    pass


def request_json(url: str) -> object:
    headers = {"User-Agent": "BetterDesk-remote-gateway-verifier/1"}
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise VerificationError(f"GitHub API request failed: {error.code} {url}") from error
    except urllib.error.URLError as error:
        raise VerificationError(f"Network request failed for {url}: {error}") from error


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "BetterDesk-remote-gateway-verifier/1"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    except (urllib.error.HTTPError, urllib.error.URLError) as error:
        raise VerificationError(f"Source download failed for {url}: {error}") from error
    if len(data) > 128 * 1024 * 1024:
        raise VerificationError(f"Source archive is unexpectedly large: {len(data)} bytes")
    return data


def allowed_url(url: str, allowed_hosts: set[str]) -> bool:
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme == "https" and parsed.hostname in allowed_hosts


def load_json(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise VerificationError(f"Cannot read {path}: {error}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"{path} must contain a JSON object")
    return value


def verify_archive_license(data: bytes, dependency: dict) -> None:
    try:
        archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")
    except tarfile.TarError as error:
        raise VerificationError(f"Invalid source archive for {dependency['id']}: {error}") from error

    names = archive.getnames()
    for license_file in dependency.get("license_files", []):
        matches = [name for name in names if name.endswith("/" + license_file)]
        if not matches:
            raise VerificationError(f"{dependency['id']} is missing {license_file}")
        content = archive.extractfile(matches[0])
        text = content.read().decode("utf-8", errors="replace") if content else ""
        if license_file == "LICENSE" and "Apache License" not in text:
            raise VerificationError(f"{dependency['id']} LICENSE is not Apache-2.0 text")


def verify_dependency(dependency: dict, allowed_hosts: set[str]) -> None:
    required = ("id", "repository", "version", "commit", "source_url", "source_sha256", "license")
    for key in required:
        if not dependency.get(key):
            raise VerificationError(f"Dependency {dependency.get('id', '<unknown>')} lacks {key}")
    commit = dependency["commit"].lower()
    if not COMMIT_RE.fullmatch(commit):
        raise VerificationError(f"{dependency['id']} does not use a full commit SHA")
    if dependency["license"] not in {"Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"}:
        raise VerificationError(f"{dependency['id']} has a non-permissive declared license")
    source_url = dependency["source_url"]
    if not allowed_url(source_url, allowed_hosts):
        raise VerificationError(f"{dependency['id']} source URL is not allowlisted: {source_url}")
    expected_api = f"https://api.github.com/repos/{dependency['repository']}/commits/{commit}"
    commit_data = request_json(expected_api)
    if not isinstance(commit_data, dict) or commit_data.get("sha", "").lower() != commit:
        raise VerificationError(f"{dependency['id']} commit cannot be verified against GitHub")
    data = download(source_url)
    actual_sha = hashlib.sha256(data).hexdigest()
    if actual_sha != dependency["source_sha256"].lower():
        raise VerificationError(
            f"{dependency['id']} checksum mismatch: expected {dependency['source_sha256']}, got {actual_sha}"
        )
    verify_archive_license(data, dependency)
    print(f"verified source: {dependency['id']} {dependency['version']} {commit}")


def check_upstream(manifest: dict) -> None:
    for dependency in manifest.get("dependencies", []):
        tags_url = f"https://api.github.com/repos/{dependency['repository']}/tags?per_page=100"
        tags = request_json(tags_url)
        stable = []
        if isinstance(tags, list):
            for tag in tags:
                name = tag.get("name", "") if isinstance(tag, dict) else ""
                match = VERSION_RE.fullmatch(name)
                if match:
                    stable.append((tuple(int(part) for part in match.groups()), name))
        if not stable:
            print(f"::warning::No stable upstream tag found for {dependency['repository']}")
            continue
        latest = max(stable)[1]
        if latest != dependency["version"]:
            print(
                f"::notice::Upstream {dependency['repository']} has {latest}; "
                f"manifest remains pinned to {dependency['version']} until reviewed"
            )
        else:
            print(f"upstream stable tag unchanged: {dependency['repository']} {latest}")


def verify_license_gate(manifest: dict, audit: dict) -> None:
    permitted = set(manifest.get("permitted_licenses", []))
    if not permitted:
        raise VerificationError("Manifest has no permitted license policy")
    rejected = [
        component
        for component in audit.get("components", [])
        if component.get("status") == "rejected"
        and component.get("license") not in permitted
    ]
    if manifest.get("runtime_enabled") and rejected:
        names = ", ".join(component.get("name", "unknown") for component in rejected)
        raise VerificationError(f"Runtime cannot be enabled with rejected dependencies: {names}")
    if manifest.get("runtime_enabled") and audit.get("review_status") != "approved":
        raise VerificationError("Runtime requires an approved license audit")
    if not manifest.get("runtime_enabled"):
        print("runtime disabled: license/runtime artifact gate is still closed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-upstream", action="store_true")
    args = parser.parse_args()
    try:
        manifest = load_json(MANIFEST_PATH)
        audit = load_json(AUDIT_PATH)
        allowed_hosts = set(manifest.get("allowed_hosts", []))
        if not allowed_hosts:
            raise VerificationError("Manifest has no allowed hosts")
        verify_license_gate(manifest, audit)
        for dependency in manifest.get("dependencies", []):
            verify_dependency(dependency, allowed_hosts)
        if args.check_upstream:
            check_upstream(manifest)
    except VerificationError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
