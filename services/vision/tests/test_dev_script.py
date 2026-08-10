from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "dev-with-vision.sh"
WEB_DIR = ROOT / "apps" / "web"


def available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_for_listener(port: int) -> None:
    for _ in range(50):
        with socket.socket() as probe:
            probe.settimeout(0.1)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.05)
    raise AssertionError(f"listener on {port} did not start")


class DevScriptTests(unittest.TestCase):
    def start_listener(self, port: int, *, repository_next: bool) -> subprocess.Popen[bytes]:
        arguments = [
            "next-server" if repository_next else sys.executable,
            "-m",
            "http.server",
            str(port),
            "--bind",
            "127.0.0.1",
        ]
        process = subprocess.Popen(
            arguments,
            executable=sys.executable,
            cwd=WEB_DIR if repository_next else "/tmp",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(self.stop_listener, process)
        wait_for_listener(port)
        return process

    @staticmethod
    def stop_listener(process: subprocess.Popen[bytes]) -> None:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)

    def run_preflight(
        self,
        frontend_port: int,
        vision_port: int | None = None,
        *,
        force_lsof_failure: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        environment = {
            **os.environ,
            "NEXTJS_PORT": str(frontend_port),
            "VISION_PORT": str(vision_port or available_port()),
        }
        override = "lsof() { return 1; }; " if force_lsof_failure else ""
        return subprocess.run(
            [
                "bash",
                "-c",
                f'source "{SCRIPT}"; {override}preflight_listeners; printf "next=%s vision=%s\\n" "$REUSE_NEXTJS" "$REUSE_VISION"',
            ],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )

    def test_reuses_nextjs_listener_owned_by_this_repository(self) -> None:
        port = available_port()
        process = self.start_listener(port, repository_next=True)
        result = self.run_preflight(port)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("next=true vision=false", result.stdout)
        self.assertIn("Reusing this repository's Next.js listener", result.stdout)
        self.assertIsNone(process.poll())

    def test_falls_back_to_ss_when_lsof_cannot_see_nextjs(self) -> None:
        port = available_port()
        process = self.start_listener(port, repository_next=True)
        result = self.run_preflight(port, force_lsof_failure=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("next=true vision=false", result.stdout)
        self.assertIsNone(process.poll())

    def test_refuses_foreign_frontend_without_stopping_it_or_starting_vision(self) -> None:
        port = available_port()
        process = self.start_listener(port, repository_next=False)
        result = self.run_preflight(port)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("belongs to another process", result.stderr)
        self.assertIn("It was not stopped", result.stderr)
        self.assertIsNone(process.poll())

    def test_reuses_healthy_loopback_vision_without_taking_ownership(self) -> None:
        port = available_port()
        server = subprocess.Popen(
            [
                sys.executable,
                "-c",
                (
                    "import sys; from http.server import BaseHTTPRequestHandler, HTTPServer; "
                    "H=type('H',(BaseHTTPRequestHandler,),{"
                    "'do_GET':lambda self:(self.send_response(200),self.send_header('Content-Type','application/json'),"
                    "self.end_headers(),self.wfile.write(b'{\"status\":\"ok\",\"model_loaded\":true,\"model\":\"MobileSAM vit_t\"}')),"
                    "'log_message':lambda *args:None}); "
                    "HTTPServer(('127.0.0.1',int(sys.argv[1])),H).serve_forever()"
                ),
                str(port),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(self.stop_listener, server)
        wait_for_listener(port)
        result = self.run_preflight(available_port(), port)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("next=false vision=true", result.stdout)
        self.assertIn("Reusing the healthy Vision Service", result.stdout)
        self.assertIsNone(server.poll())

    def test_waits_past_sixty_seconds_for_mobilesam(self) -> None:
        environment = {
            **os.environ,
            "VISION_STARTUP_TIMEOUT": "180",
            "VISION_STARTUP_GRACE": "1",
            "SERVICE_WAIT_INTERVAL": "0",
        }
        result = subprocess.run(
            [
                "bash",
                "-c",
                (
                    f'source "{SCRIPT}"; '
                    "checks=0; VISION_PID=$$; "
                    "vision_service_is_healthy() { checks=$((checks + 1)); [ \"$checks\" -gt 60 ]; }; "
                    "kill() { return 0; }; "
                    "wait_for_vision; printf ' checks=%s\\n' \"$checks\""
                ),
            ],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ready.", result.stdout)
        self.assertIn("checks=61", result.stdout)

    def test_rejects_startup_timeout_below_three_minutes(self) -> None:
        result = subprocess.run(
            ["bash", "-c", f'source "{SCRIPT}"'],
            check=False,
            capture_output=True,
            text=True,
            env={**os.environ, "VISION_STARTUP_TIMEOUT": "60"},
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("at least 180 seconds", result.stderr)


if __name__ == "__main__":
    unittest.main()
