"""Rewrite the open source sections of README.md from merged pull requests.

Finds every merged pull request by GH_USER in repositories the user doesn't
own, then fills three marked sections of the README: an impact badge, a row of
per-project badges, and a list of the most recent merges. Standard library
only, so the workflow needs no install step.
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

USER = os.environ.get("GH_USER", "Iitian001")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
README = Path(__file__).resolve().parent.parent / "README.md"
RECENT_LIMIT = 8
GREEN = "39FF14"
BACKGROUND = "0d1117"

# Simple Icons slugs for projects that have one; the rest get the GitHub mark.
LOGOS = {
    "reactjs/react.dev": "react",
    "facebook/react": "react",
    "hanzoai/php-sdk": "php",
}


def api(path: str) -> dict:
    request = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "profile-readme-oss-updater",
            **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}),
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def merged_pull_requests() -> list[dict]:
    query = f"is:pr is:merged author:{USER} -user:{USER}"
    results = []
    for page in range(1, 11):
        params = urllib.parse.urlencode(
            {"q": query, "sort": "updated", "order": "desc", "per_page": 100, "page": page}
        )
        items = api(f"/search/issues?{params}")["items"]
        results.extend(items)
        if len(items) < 100:
            break
    pulls = [
        {
            "repo": item["repository_url"].removeprefix("https://api.github.com/repos/"),
            "title": item["title"],
            "url": item["html_url"],
            "merged_at": item["pull_request"]["merged_at"],
        }
        for item in results
        if item.get("pull_request", {}).get("merged_at")
    ]
    return sorted(pulls, key=lambda pull: pull["merged_at"], reverse=True)


def short_number(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M".replace(".0M", "M")
    if value >= 1_000:
        return f"{value / 1_000:.1f}k".replace(".0k", "k")
    return str(value)


def badge_text(text: str) -> str:
    return urllib.parse.quote(text.replace("-", "--").replace("_", "__"), safe="")


def impact_section(pulls: list[dict], stars: dict[str, int]) -> str:
    repos = len(stars)
    total = short_number(sum(stars.values()))
    label = badge_text(f"{len(pulls)} PRs merged into {repos} projects")
    message = badge_text(f"{total} combined ⭐")
    search = urllib.parse.quote(f"is:pr is:merged author:{USER} -user:{USER}")
    return (
        '<p align="center">\n'
        f'  <a href="https://github.com/search?q={search}&type=pullrequests">'
        f'<img alt="{len(pulls)} pull requests merged into {repos} open source projects '
        f'with {total} combined stars" '
        f'src="https://img.shields.io/badge/{label}-{message}-{GREEN}'
        f'?style=for-the-badge&labelColor={BACKGROUND}&logo=github&logoColor={GREEN}" /></a>\n'
        "</p>"
    )


def display_names(repos: set[str]) -> dict[str, str]:
    """Repo name alone, or owner/name when two repos share a name."""
    names = Counter(repo.split("/", 1)[1] for repo in repos)
    return {repo: repo if names[repo.split("/", 1)[1]] > 1 else repo.split("/", 1)[1] for repo in repos}


def star_note(count: int) -> str:
    return f" ★{short_number(count)}" if count >= 100 else ""


def badges_section(pulls: list[dict], stars: dict[str, int]) -> str:
    counts = Counter(pull["repo"] for pull in pulls)
    names = display_names(set(counts))
    lines = []
    for repo in sorted(counts, key=lambda name: (-stars[name], name)):
        name = names[repo]
        merged = f"{counts[repo]} merged"
        logo = LOGOS.get(repo, "github")
        search = urllib.parse.quote(f"is:pr is:merged author:{USER}")
        lines.append(
            f"[![{name}](https://img.shields.io/badge/{badge_text(name)}-{badge_text(merged)}-{BACKGROUND}"
            f"?style=flat-square&logo={logo}&logoColor={GREEN}&labelColor={BACKGROUND}&color=1a1f29)]"
            f"(https://github.com/{repo}/pulls?q={search})"
        )
    # Blank lines around the markdown, or GitHub shows it as raw HTML text.
    return '<p align="center">\n\n' + "\n".join(lines) + "\n\n</p>"


def recent_section(pulls: list[dict], stars: dict[str, int]) -> str:
    names = display_names({pull["repo"] for pull in pulls})
    lines = []
    for pull in pulls[:RECENT_LIMIT]:
        repo = pull["repo"]
        title = pull["title"].replace("|", "\\|").replace("[", "\\[").replace("]", "\\]")
        lines.append(
            f"- `{pull['merged_at'][:10]}` **[{names[repo]}](https://github.com/{repo})**"
            f"{star_note(stars[repo])} · [{title}]({pull['url']})"
        )
    return "\n".join(lines)


def replace_section(text: str, name: str, body: str) -> str:
    pattern = re.compile(rf"(<!-- {name}:START -->\n)(?:.*?\n)?(<!-- {name}:END -->)", re.S)
    if not pattern.search(text):
        sys.exit(f"README.md has no {name}:START / {name}:END markers")
    return pattern.sub(lambda match: match.group(1) + body + "\n" + match.group(2), text)


def main() -> None:
    pulls = merged_pull_requests()
    if not pulls:
        sys.exit("No merged pull requests found; leaving README.md unchanged")
    stars = {repo: api(f"/repos/{repo}")["stargazers_count"] for repo in {pull["repo"] for pull in pulls}}
    text = README.read_text(encoding="utf-8").replace("\r\n", "\n")
    text = replace_section(text, "OSS-IMPACT", impact_section(pulls, stars))
    text = replace_section(text, "OSS-BADGES", badges_section(pulls, stars))
    text = replace_section(text, "OSS-RECENT", recent_section(pulls, stars))
    README.write_text(text, encoding="utf-8", newline="\n")
    print(f"{len(pulls)} merged pull requests across {len(stars)} projects")


if __name__ == "__main__":
    main()
