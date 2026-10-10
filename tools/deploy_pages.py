"""
Publish the built site to GitHub Pages.

GitHub Pages serves a project site from https://<user>.github.io/<repo>/, so the
build has to use that sub-path as its base. This script:

  1. builds with VITE_BASE=/<repo>/ (the root base used by Vercel is untouched),
  2. drops .nojekyll and a 404.html fallback into dist/,
  3. commits dist/ as the root of the `gh-pages` branch and pushes it,
  4. enables / updates the repository's Pages configuration,
  5. waits for the published URL to answer.

Run:  python tools/deploy_pages.py [--repo WangLing1206/datalens] [--build-only]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DEFAULT_REPO = "WangLing1206/datalens"
BRANCH = "gh-pages"


def run(cmd: list[str], cwd: str = ROOT, capture: bool = True, env: dict | None = None) -> str:
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=capture, text=True, errors="replace",
        env={**os.environ, **(env or {})},
    )
    if proc.returncode != 0:
        if capture:
            print(proc.stdout[-2000:])
            print(proc.stderr[-3000:])
        raise SystemExit(f"command failed: {' '.join(cmd)}")
    return proc.stdout if capture else ""


def build(repo_name: str) -> str:
    base = f"/{repo_name}/"
    print(f"building with base {base} …")
    run(["npm", "run", "build"], env={"VITE_BASE": base})
    dist = os.path.join(ROOT, "dist")
    if not os.path.isdir(dist):
        raise SystemExit("dist/ was not produced")

    # Without .nojekyll, Pages runs Jekyll and drops files it does not like.
    with open(os.path.join(dist, ".nojekyll"), "w", encoding="utf-8") as f:
        f.write("")
    # Hash routing means every real URL is index.html, but a stray path (a
    # bookmark without the hash, a truncated link) should still land on the app.
    shutil.copyfile(os.path.join(dist, "index.html"), os.path.join(dist, "404.html"))
    print("dist/ ready: .nojekyll + 404.html written")
    return dist


def publish(dist: str, repo: str, message: str) -> None:
    """Commit dist/ as the root of the gh-pages branch, without touching the
    working tree of the source repository."""
    remote = f"https://github.com/{repo}.git"
    tmp = tempfile.mkdtemp(prefix="datalens-pages-")
    try:
        run(["git", "init", "-q", "-b", BRANCH], cwd=tmp)
        run(["git", "remote", "add", "origin", remote], cwd=tmp)
        for name in os.listdir(dist):
            src = os.path.join(dist, name)
            dst = os.path.join(tmp, name)
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
        run(["git", "add", "-A"], cwd=tmp)
        run(["git", "-c", "user.name=DataLens", "-c", "user.email=datalens@example.com",
             "commit", "-q", "-m", message], cwd=tmp)
        print(f"pushing {BRANCH} to {repo} …")
        run(["git", "push", "-f", "origin", BRANCH], cwd=tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def api(repo: str, path: str, method: str = "GET", payload: dict | None = None) -> tuple[int, dict]:
    cmd = ["gh", "api", "-X", method, f"repos/{repo}{path}"]
    if payload is not None:
        cmd += ["--input", "-"]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace",
                          input=json.dumps(payload) if payload is not None else None)
    body = proc.stdout.strip()
    try:
        data = json.loads(body) if body else {}
    except json.JSONDecodeError:
        data = {"raw": body}
    return proc.returncode, data


def configure_pages(repo: str) -> str:
    payload = {"source": {"branch": BRANCH, "path": "/"}}
    code, data = api(repo, "/pages", "POST", payload)
    if code != 0:
        code, data = api(repo, "/pages", "PUT", payload)
    if code != 0:
        print("could not configure Pages:", data)
        raise SystemExit(1)
    return data.get("html_url") or f"https://{repo.split('/')[0].lower()}.github.io/{repo.split('/')[1]}/"


def wait_for(url: str, timeout: float = 240.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "datalens-deploy"})
            with urllib.request.urlopen(req, timeout=20) as res:
                if res.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(6)
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=DEFAULT_REPO, help="owner/name on GitHub")
    ap.add_argument("--message", default="Deploy DataLens to GitHub Pages")
    ap.add_argument("--build-only", action="store_true", help="build into dist/ and stop")
    args = ap.parse_args()

    repo_name = args.repo.split("/")[1]
    dist = build(repo_name)
    if args.build_only:
        return

    publish(dist, args.repo, args.message)
    # Pages needs a moment after the first push to start building.
    time.sleep(5)
    url = configure_pages(args.repo)
    print(f"pages url: {url}")

    if wait_for(url):
        print(f"published: {url}")
    else:
        print(f"pushed, but {url} did not answer yet — Pages may still be building "
              f"(check: gh api repos/{args.repo}/pages/builds/latest)")


if __name__ == "__main__":
    main()
