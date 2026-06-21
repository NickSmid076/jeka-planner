#!/usr/bin/env python3
"""
JEKA Dashboard Server v2
Start met: python3 dashboard_server_v2.py
Opent automatisch http://localhost:5050
"""

import json
import os
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Timer

BASE       = Path(__file__).parent
DASHBOARD  = BASE / "dashboard"
ROSTER_JSON = BASE / "roster_export.json"
AVAIL_JSON  = BASE / "availability.json"
EXCEL       = BASE / "Trainingschema planner v2.xlsx"

MIME = {".html": "text/html", ".css": "text/css", ".js": "application/javascript",
        ".json": "application/json", ".ico": "image/x-icon"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._file(DASHBOARD / "index.html", "text/html")
        elif path == "/api/roster":
            self._file(ROSTER_JSON, "application/json")
        elif path == "/api/availability":
            self._file(AVAIL_JSON if AVAIL_JSON.exists() else None, "application/json", b"{}")
        else:
            fp  = DASHBOARD / path.lstrip("/")
            ext = fp.suffix.lower()
            if fp.is_file():
                self._file(fp, MIME.get(ext, "application/octet-stream"))
            else:
                self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        if self.path == "/api/availability":
            try:
                data = json.loads(body)
                AVAIL_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2))
                self._json({"ok": True})
            except Exception as e:
                self.send_error(500, str(e))
        elif self.path == "/api/refresh":
            try:
                r = subprocess.run(
                    [sys.executable, str(BASE / "planner_v2.py"), "--file", str(EXCEL)],
                    capture_output=True, text=True, cwd=str(BASE),
                )
                self._json({
                    "ok":     r.returncode == 0,
                    "output": r.stdout[-3000:] if r.stdout else "",
                    "error":  r.stderr[-500:]  if r.stderr else "",
                })
            except Exception as e:
                self.send_error(500, str(e))
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _file(self, path, ct, fallback=None):
        try:
            data = Path(path).read_bytes() if path else fallback
            if data is None:
                data = fallback or b""
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            if fallback is not None:
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self._cors()
                self.end_headers()
                self.wfile.write(fallback)
            else:
                self.send_error(404)

    def _json(self, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port   = 5050
    server = HTTPServer(("localhost", port), Handler)
    url    = f"http://localhost:{port}"
    print(f"JEKA Dashboard v2 → {url}")
    print("Druk Ctrl+C om te stoppen.")
    Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer gestopt.")
