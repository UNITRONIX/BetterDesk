#!/usr/bin/env python3
"""Watch upstream RustDesk client + OSS server releases and open review Issues.

Does not vendor AGPL sources. Updates config/rustdesk-upstream-watch.json
last_seen_* fields and creates GitHub Issues labeled Next Updates when
last_seen_tag differs from last_reviewed_tag.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "config" / "rustdesk-upstream-watch.json"
VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
MARKER_RE = re.compile(
    r"<!--\s*rustdesk-upstream-watch:\s*([a-z_]+)=([^\s>]+)\s*-->",
    re.IGNORECASE,
)
COMPONENT_KEYS = ("client", "server_oss")


class WatchError(RuntimeError):
    pass


def request_json(url: str) -> Any:
    headers = {"User-Agent": "BetterDesk-rustdesk-upstream-watch/1", "Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN", "").strip() or os.environ.get("GH_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise WatchError(f"GitHub API request failed: {error.code} {url}") from error
    except urllib.error.URLError as error:
        raise WatchError(f"Network request failed for {url}: {error}") from error


def version_key(tag: str) -> tuple[int, int, int]:
    match = VERSION_RE.fullmatch(tag.strip())
    if not match:
        raise WatchError(f"unsupported version tag: {tag!r}")
    return tuple(int(part) for part in match.groups())


def normalize_tag(tag: str) -> str:
    tag = tag.strip()
    if tag.startswith("v") and VERSION_RE.fullmatch(tag):
        return tag[1:]
    return tag


def load_manifest() -> dict[str, Any]:
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise WatchError(f"Cannot read {MANIFEST_PATH}: {error}") from error
    if not isinstance(data, dict):
        raise WatchError(f"{MANIFEST_PATH} must contain a JSON object")
    for key in COMPONENT_KEYS:
        if key not in data or not isinstance(data[key], dict):
            raise WatchError(f"manifest missing component object: {key}")
    return data


def write_manifest(data: dict[str, Any]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def fetch_latest_stable_release(repository: str) -> dict[str, str]:
    """Return {tag, published_at, html_url} for the newest stable semver release."""
    url = f"https://api.github.com/repos/{repository}/releases?per_page=30"
    payload = request_json(url)
    if not isinstance(payload, list):
        raise WatchError(f"unexpected releases payload for {repository}")

    best: dict[str, str] | None = None
    best_key: tuple[int, int, int] | None = None
    for item in payload:
        if not isinstance(item, dict):
            continue
        if item.get("draft") or item.get("prerelease"):
            continue
        tag = normalize_tag(str(item.get("tag_name") or ""))
        if not VERSION_RE.fullmatch(tag):
            continue
        key = version_key(tag)
        if best_key is None or key > best_key:
            best_key = key
            best = {
                "tag": tag,
                "published_at": str(item.get("published_at") or ""),
                "html_url": str(item.get("html_url") or f"https://github.com/{repository}/releases/tag/{tag}"),
            }
    if best is None:
        raise WatchError(f"no stable semver releases found for {repository}")
    return best


def run_gh(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    token = env.get("GITHUB_TOKEN", "").strip()
    if token and not env.get("GH_TOKEN"):
        env["GH_TOKEN"] = token
    result = subprocess.run(
        ["gh", *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and result.returncode != 0:
        raise WatchError(
            f"gh {' '.join(args)} failed ({result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
        )
    return result


def ensure_labels(labels: list[str]) -> None:
    listed = run_gh(["label", "list", "--json", "name", "--limit", "200"], check=False)
    names: set[str] = set()
    if listed.returncode == 0 and listed.stdout.strip():
        try:
            payload = json.loads(listed.stdout)
            if isinstance(payload, list):
                names = {str(item.get("name")) for item in payload if isinstance(item, dict)}
        except json.JSONDecodeError:
            names = set()
    for label in labels:
        if label in names:
            continue
        color = "0E8A16" if label == "compatibility" else "0869f8"
        created = run_gh(
            [
                "label",
                "create",
                label,
                "--color",
                color,
                "--description",
                "RustDesk / BetterDesk compatibility tracking",
            ],
            check=False,
        )
        if created.returncode != 0 and "already exists" not in (created.stderr + created.stdout).lower():
            raise WatchError(f"failed to create label {label!r}: {created.stderr.strip()}")


def open_issues_for_component(component_id: str, tag: str) -> bool:
    """Return True if an open Issue already tracks this component+tag."""
    # Search open issues in this repo that mention the watch marker.
    result = run_gh(
        [
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,body,title",
            "--search",
            f"rustdesk-upstream-watch in:body",
        ],
        check=False,
    )
    if result.returncode != 0:
        # Fallback without search (older gh / rate limits)
        result = run_gh(
            ["issue", "list", "--state", "open", "--limit", "100", "--json", "number,body,title"],
            check=True,
        )
    issues = json.loads(result.stdout or "[]")
    if not isinstance(issues, list):
        return False
    needle = f"{component_id}={tag}"
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        body = str(issue.get("body") or "")
        for match in MARKER_RE.finditer(body):
            if match.group(1) == component_id and match.group(2) == tag:
                return True
        if needle in body:
            return True
    return False


def build_issue_body(
    *,
    component_id: str,
    repository: str,
    tag: str,
    html_url: str,
    checklist_doc: str,
    audit_doc: str,
) -> str:
    title_component = "client" if component_id == "client" else "OSS server"
    return f"""## RustDesk upstream watch

New **{title_component}** release needs a BetterDesk compatibility review.

- Repository: `{repository}`
- Tag: `{tag}`
- Release: {html_url}

<!-- rustdesk-upstream-watch: {component_id}={tag} -->

### Checklist

Follow [`{checklist_doc}`](https://github.com/UNITRONIX/BetterDesk/blob/dev/{checklist_doc}) end-to-end (manual lab + code review). Record findings in [`{audit_doc}`](https://github.com/UNITRONIX/BetterDesk/blob/dev/{audit_doc}).

- [ ] Bootstrap / deploy string / deep-link / no public fallback
- [ ] RegisterPk / enrollment modes
- [ ] Signal: PunchHole, RequestRelay, ConfigUpdate behaviour
- [ ] Relay host:port + TLS/WSS
- [ ] Client API: login, AB, heartbeat, strategy/options (locked keys)
- [ ] Session smoke: remote, clipboard, files, terminal
- [ ] Proto drift vs BetterDesk canonical schemas (diff only, no AGPL import)
- [ ] Update `config/rustdesk-upstream-watch.json` → `last_reviewed_tag` for `{component_id}`
- [ ] Add / update audit section for `{tag}`

### Notes

- BetterDesk ships clean-room `betterdesk-server` (not AGPL `rustdesk-server`).
- Do **not** auto-close this issue; leave closing to the operator.
- Stock RustDesk GUI binaries stay out of CI — lab verification is manual.
"""


def create_review_issue(
    *,
    component_id: str,
    repository: str,
    tag: str,
    html_url: str,
    labels: list[str],
    checklist_doc: str,
    audit_doc: str,
    dry_run: bool,
) -> None:
    title_component = "client" if component_id == "client" else "OSS server"
    title = f"compat: review RustDesk {title_component} {tag} vs BetterDesk"
    body = build_issue_body(
        component_id=component_id,
        repository=repository,
        tag=tag,
        html_url=html_url,
        checklist_doc=checklist_doc,
        audit_doc=audit_doc,
    )
    if dry_run:
        print(f"[dry-run] would create issue: {title}")
        return
    ensure_labels(labels)
    args = ["issue", "create", "--title", title, "--body", body]
    for label in labels:
        args.extend(["--label", label])
    result = run_gh(args, check=True)
    print(f"created issue for {component_id}={tag}: {result.stdout.strip()}")


def refresh_component(component: dict[str, Any]) -> tuple[bool, dict[str, str] | None]:
    repository = str(component.get("repository") or "")
    if not repository:
        raise WatchError("component missing repository")
    latest = fetch_latest_stable_release(repository)
    changed = False
    prev_tag = str(component.get("last_seen_tag") or "")
    if not prev_tag or version_key(latest["tag"]) > version_key(prev_tag):
        component["last_seen_tag"] = latest["tag"]
        component["last_seen_published_at"] = latest["published_at"]
        changed = True
    elif prev_tag == latest["tag"] and latest["published_at"] and component.get("last_seen_published_at") != latest["published_at"]:
        component["last_seen_published_at"] = latest["published_at"]
        changed = True
    return changed, latest


def needs_review(component: dict[str, Any]) -> bool:
    seen = str(component.get("last_seen_tag") or "").strip()
    reviewed = str(component.get("last_reviewed_tag") or "").strip()
    return bool(seen) and seen != reviewed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report without writing or creating Issues")
    parser.add_argument("--no-issues", action="store_true", help="Update last_seen only; do not create Issues")
    parser.add_argument("--write", action="store_true", help="Persist last_seen updates to the manifest")
    args = parser.parse_args()

    manifest = load_manifest()
    labels = [str(x) for x in manifest.get("issue_labels") or ["Next Updates", "compatibility"]]
    checklist_doc = str(manifest.get("checklist_doc") or "docs/important/rustdesk-compat-checklist.md")
    audit_doc = str(manifest.get("audit_doc") or "docs/RDCLIENT_VS_RUSTDESK_AUDIT.md")

    any_changed = False
    latest_by_id: dict[str, dict[str, str]] = {}

    for key in COMPONENT_KEYS:
        component = manifest[key]
        component.setdefault("id", key)
        changed, latest = refresh_component(component)
        any_changed = any_changed or changed
        if latest:
            latest_by_id[key] = latest
        print(
            f"{key}: seen={component.get('last_seen_tag')} "
            f"reviewed={component.get('last_reviewed_tag') or '(none)'} "
            f"latest={latest['tag'] if latest else '?'}"
        )

    if any_changed and args.write and not args.dry_run:
        write_manifest(manifest)
        print(f"updated {MANIFEST_PATH.relative_to(ROOT)}")
    elif any_changed and (args.dry_run or not args.write):
        print("manifest has last_seen updates (not written; pass --write)")
    else:
        print("manifest last_seen unchanged")

    if args.no_issues:
        return 0

    for key in COMPONENT_KEYS:
        component = manifest[key]
        if not needs_review(component):
            continue
        tag = str(component["last_seen_tag"])
        latest = latest_by_id.get(key) or {
            "tag": tag,
            "html_url": f"https://github.com/{component['repository']}/releases/tag/{tag}",
        }
        if open_issues_for_component(key, tag):
            print(f"open issue already tracks {key}={tag}")
            continue
        create_review_issue(
            component_id=key,
            repository=str(component["repository"]),
            tag=tag,
            html_url=str(latest["html_url"]),
            labels=labels,
            checklist_doc=checklist_doc,
            audit_doc=audit_doc,
            dry_run=args.dry_run,
        )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except WatchError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
