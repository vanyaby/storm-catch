"""Run from any directory with Python 3 and Chrome/Chromium. Set CHROME to override."""
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
chrome = os.environ.get("CHROME") or shutil.which("google-chrome") or shutil.which("chromium")
if not chrome:
    chrome = Path(os.environ.get("PROGRAMFILES", "")) / "Google/Chrome/Application/chrome.exe"

failed = False
with tempfile.TemporaryDirectory() as scratch:
    root = Path(scratch)
    shutil.copytree(ROOT / 'vendor', root / 'vendor')
    shutil.copytree(ROOT / 'js', root / 'js')
    for suite in ("game", "vr"):
        page = re.sub(r'<link[^>]*https://fonts[^>]*>', '', (ROOT/'index.html').read_text(encoding='utf-8'))
        script = (ROOT/'tests'/(suite+'.js')).read_text(encoding='utf-8')
        probe = root/(suite+'.html')
        probe.write_text(page+'<script type="module">'+script+'</script>', encoding='utf-8')
        result = subprocess.run([str(chrome), "--headless", "--no-first-run", "--no-proxy-server",
            "--disable-extensions", "--allow-file-access-from-files", "--user-data-dir="+str(root/(suite+"-profile")),
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--virtual-time-budget=5000",
            "--dump-dom", probe.as_uri()],capture_output=True,timeout=90)
        match = re.search(rb'data-results="([^"]*)"',result.stdout)
        if not match:
            raise RuntimeError(suite + " did not finish: " + result.stderr.decode(errors="replace")[-2000:])
        report=json.loads(html.unescape(match[1].decode()))
        for case in report["checks"]:
            print(("PASS " if case["pass"] else "FAIL ") + case["name"])
            failed |= not case["pass"]
        if report.get("error"):
            print(report["error"])
            failed=True
        failed |= not bool(report["checks"])

raise SystemExit(int(failed))
