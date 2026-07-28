#!/usr/bin/env python3
"""Deploy prebuilt ./dist to Vercel via REST API (no CLI needed).

Token is read from the VERCEL_TOKEN env var (never printed, never written).
Usage: VERCEL_TOKEN=xxx python vercel_deploy.py [dist_dir]
"""
import base64
import json
import os
import sys
import urllib.request

PROJECT_NAME = "md-docx-merger"
API = "https://api.vercel.com"


def build_files(dist_dir):
    files = []
    for root, _dirs, names in os.walk(dist_dir):
        for name in names:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, dist_dir).replace(os.sep, "/")
            with open(full, "rb") as fh:
                data = base64.b64encode(fh.read()).decode("ascii")
            files.append({"file": rel, "data": data, "encoding": "base64"})
    return files


def main():
    token = os.environ.get("VERCEL_TOKEN")
    if not token:
        sys.exit("ERROR: VERCEL_TOKEN env var not set")
    dist_dir = sys.argv[1] if len(sys.argv) > 1 else "dist"
    files = build_files(dist_dir)
    body = {
        "name": PROJECT_NAME,
        "target": "production",
        "files": files,
        "projectSettings": {"framework": None, "buildCommand": None,
                            "outputDirectory": None, "installCommand": None},
    }
    url = f"{API}/v13/deployments?forceNew=1&teamId="
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            out = json.load(resp)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}")
    print("readyState:", out.get("readyState"))
    print("id:", out.get("id"))
    print("url:", out.get("url"))
    print("alias:", out.get("alias"))
    print("target:", out.get("target"))
    if out.get("errors"):
        print("errors:", out["errors"])


if __name__ == "__main__":
    main()
