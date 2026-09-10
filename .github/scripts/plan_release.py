"""Decide whether a push to main makes a release, and with which versions.

The release workflow runs this on every push. Run it locally for a dry run:

    python .github/scripts/plan_release.py

Rules:

- Only product code counts: the paths in FIRMWARE and DESKTOP below. Tools,
  scripts, tests, notes, docs, models and branding never make a release.
- A release is made when product code changed since the last release tag
  (v<x.y.z>), or when there has been no release yet. A commit in the push whose
  first line contains [skip release] holds it back; the changes go out with the
  next release instead.
- The release version bumps the patch number. [minor] or [major] in the first
  line of a commit since the last release bumps that part instead. Markers
  count only in the first line, so a message body can explain them without
  triggering them. Raising "version" in
  DeckSrc/desktop/package.json also works: the release never numbers lower.
  The app is stamped with the release version.
- The firmware keeps its own version, marked by firmware-v<x.y.z> tags. It only
  goes up when firmware code changed since that tag, by the same rule applied
  to the commits that touched firmware. The app offers a deck update only when
  it goes up, so a desktop-only release never asks anyone to reflash.
"""

import json
import os
import re
import subprocess
import sys
import uuid

FIRMWARE = [
    "DeckSrc/firmware/src",
    "DeckSrc/firmware/include",
    "DeckSrc/firmware/lib",
    "DeckSrc/firmware/patches",
    "DeckSrc/firmware/scripts",
    "DeckSrc/firmware/platformio.ini",
    "DeckSrc/firmware/partitions_deck.csv",
    "DeckSrc/firmware/esp32-s3-devkitc-1-myboard.json",
]
DESKTOP = [
    "DeckSrc/desktop/src",
    "DeckSrc/desktop/resources",
    "DeckSrc/desktop/package.json",
    "DeckSrc/desktop/pnpm-lock.yaml",
    "DeckSrc/desktop/electron.vite.config.ts",
    "DeckSrc/desktop/tsconfig.json",
    "DeckSrc/desktop/tsconfig.node.json",
    "DeckSrc/desktop/tsconfig.web.json",
]
FIRST_FIRMWARE = (0, 1, 0)
MARKERS = re.compile(r"\s*\[(?:minor|major|skip release)\]", re.IGNORECASE)
TRAILERS = re.compile(r"^(?:co-authored-by|signed-off-by):", re.IGNORECASE)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout


def newest(prefix: str) -> tuple[tuple[int, int, int], str] | None:
    """The highest <prefix>x.y.z tag, as (version, tag)."""
    found = []
    for tag in git("tag", "--list", f"{prefix}*").split():
        match = re.fullmatch(re.escape(prefix) + r"(\d+)\.(\d+)\.(\d+)", tag)
        if match:
            found.append((tuple(int(part) for part in match.groups()), tag))
    return max(found) if found else None


def commits(since: str | None, paths: list[str]) -> list[tuple[str, str]]:
    """(sha, message) of each commit after `since` that touched `paths`, newest first."""
    span = f"{since}..HEAD" if since else "HEAD"
    log = git("log", "--format=%H%x1f%B%x1e", span, "--", *paths)
    entries = [entry.strip("\n") for entry in log.split("\x1e")]
    return [tuple(entry.split("\x1f", 1)) for entry in entries if entry]


def subject(message: str) -> str:
    """A commit message's first line - the only place markers count."""
    return message.strip().split("\n", 1)[0]


def bump(version: tuple[int, int, int], messages: list[str]) -> tuple[int, int, int]:
    text = "\n".join(subject(message) for message in messages).lower()
    if "[major]" in text:
        return (version[0] + 1, 0, 0)
    if "[minor]" in text:
        return (version[0], version[1] + 1, 0)
    return (version[0], version[1], version[2] + 1)


def dotted(version: tuple[int, int, int]) -> str:
    return ".".join(str(part) for part in version)


def pushed_messages() -> list[str]:
    """Messages of the commits in this push; just the newest when that is unknown."""
    before = os.environ.get("PUSH_BEFORE", "")
    if before and set(before) != {"0"}:
        try:
            return [message for _, message in commits(before, ["."])]
        except subprocess.CalledProcessError:
            pass  # Force-pushed over, or not fetched: fall back to the head commit.
    return [git("log", "-1", "--format=%B")]


def section(title: str, entries: list[tuple[str, str]]) -> list[str]:
    if not entries:
        return []
    lines = [f"### {title}", ""]
    for sha, message in entries:
        subject, _, body = MARKERS.sub("", message).strip().partition("\n")
        lines.append(f"- {subject.strip()} ({sha[:7]})")
        for line in body.strip().splitlines():
            if line.strip() and not TRAILERS.match(line.strip()):
                lines.append(f"  {line.rstrip()}")
    return lines + [""]


def plan() -> dict[str, str]:
    last = newest("v")
    last_tag = last[1] if last else None
    desktop = commits(last_tag, DESKTOP)
    firmware = commits(last_tag, FIRMWARE)

    firmware_mark = newest("firmware-v")
    if firmware_mark:
        since_mark = commits(firmware_mark[1], FIRMWARE)
        firmware_bumped = bool(since_mark)
        firmware_version = (
            bump(firmware_mark[0], [m for _, m in since_mark])
            if since_mark
            else firmware_mark[0]
        )
    else:
        firmware_bumped, firmware_version = True, FIRST_FIRMWARE

    with open("DeckSrc/desktop/package.json", encoding="utf-8") as file:
        declared = tuple(
            int(part) for part in json.load(file)["version"].split(".")[:3]
        )
    if last:
        version = max(bump(last[0], [m for _, m in desktop + firmware]), declared)
    else:
        version = declared

    if any(
        "[skip release]" in subject(message).lower() for message in pushed_messages()
    ):
        release, reason = False, "a commit in this push says [skip release]"
    elif last and not (desktop or firmware):
        release, reason = False, f"no product code changed since {last_tag}"
    else:
        release = True
        reason = (
            f"product code changed since {last_tag}"
            if last
            else "there is no release yet"
        )

    state = "updated" if firmware_bumped else "unchanged"
    notes = [
        f"Desktop app {dotted(version)} · Deck firmware {dotted(firmware_version)} ({state})",
        "",
        "Windows: run the `Decky-Setup` installer. Update the deck from Decky: "
        "Settings → Firmware → Check GitHub for updates, with the deck on USB.",
        "",
        *section("Desktop", desktop),
        *section("Firmware", firmware),
    ]
    return {
        "release": "true" if release else "false",
        "reason": reason,
        "version": dotted(version),
        "firmware_version": dotted(firmware_version),
        "firmware_bumped": "true" if firmware_bumped else "false",
        "notes": "\n".join(notes).rstrip() + "\n",
    }


def main() -> None:
    # The notes contain arrows; a Windows console defaults to a code page without them.
    sys.stdout.reconfigure(encoding="utf-8")
    result = plan()
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as file:
            for key, value in result.items():
                delimiter = f"EOF_{uuid.uuid4().hex}"
                file.write(f"{key}<<{delimiter}\n{value}\n{delimiter}\n")
    verdict = (
        f"release v{result['version']}" if result["release"] == "true" else "no release"
    )
    print(f"{verdict}: {result['reason']}")
    print(
        f"firmware {result['firmware_version']} ({'bumped' if result['firmware_bumped'] == 'true' else 'unchanged'})"
    )
    print("--- notes ---")
    print(result["notes"])


if __name__ == "__main__":
    main()
