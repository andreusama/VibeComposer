#!/usr/bin/env python3
"""
Vibe Composer dev server.
- Serves static files (replaces python3 -m http.server)
- Proxies POST /api/claude → https://api.anthropic.com/v1/messages
  adding the API key server-side so it never touches the browser.

Usage:
    Put ANTHROPIC_API_KEY=sk-ant-... in a .env file next to this script
    (git-ignored, read once at startup), or export it in your shell —
    either way: python3 server.py
"""

import http.server
import urllib.request
import urllib.error
import os
import sys

PORT = 3000


def load_dotenv(path):
    """Minimal .env loader — KEY=VALUE per line, no external dependency.
    Only fills in vars not already set in the real environment, so an
    explicit `export` always wins over the file."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


class Handler(http.server.SimpleHTTPRequestHandler):

    # ── CORS preflight ────────────────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    # ── API proxy ─────────────────────────────────────────────────────────────
    def do_POST(self):
        if self.path != "/api/claude":
            self.send_error(404)
            return

        if not API_KEY:
            self.send_error(500, "ANTHROPIC_API_KEY env variable is not set")
            return

        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data    = body,
            method  = "POST",
            headers = {
                "Content-Type":      "application/json",
                "x-api-key":         API_KEY,
                "anthropic-version": "2023-06-01",
            },
        )

        try:
            with urllib.request.urlopen(req) as resp:
                payload = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._cors_headers()
                self.end_headers()
                self.wfile.write(payload)

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(e.read())

    # ── Static files (GET) handled by SimpleHTTPRequestHandler ───────────────

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    # Silence request logs — remove this line if you want to see them
    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: set your API key first — either:")
        print("  echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env")
        print("  export ANTHROPIC_API_KEY=sk-ant-...")
        sys.exit(1)

    # Serve from the directory where this script lives
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    with http.server.HTTPServer(("", PORT), Handler) as server:
        print(f"Vibe Composer running at http://localhost:{PORT}")
        server.serve_forever()
