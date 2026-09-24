#!/usr/bin/env python3
"""RFID node simulator.

Sends the same HTTP requests as the ESP8266 + PN532 firmware, so the
dashboard can be demonstrated without any hardware.

Examples
--------
    # one event
    python tools/rfid_simulator.py --tag 04A1B2C3D4 --reader reader_1

    # random tags on both readers every 2 s
    python tools/rfid_simulator.py --loop --interval 2

No third-party dependencies (standard library only).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

DEFAULT_TAGS = ["04A1B2C3D4E580", "DEADBEEF", "1A2B3C4D", "7F00A1C2"]
DEFAULT_READERS = ["reader_1", "reader_2"]


def post_rfid(base_url: str, tag_uid: str, reader_id: str, timeout: float = 2.0) -> dict:
    body = json.dumps({"tag_uid": tag_uid, "reader_id": reader_id}).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/rfid",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    p = argparse.ArgumentParser(description="Simulate the Energy Demonstrator RFID node.")
    p.add_argument("--url", default="http://127.0.0.1:8000", help="backend base URL")
    p.add_argument("--tag", help="tag UID (hex). Random if omitted")
    p.add_argument("--reader", help="reader id. Random if omitted")
    p.add_argument("--loop", action="store_true", help="keep sending events")
    p.add_argument("--interval", type=float, default=2.0, help="seconds between events in --loop mode")
    args = p.parse_args()

    try:
        while True:
            tag = args.tag or random.choice(DEFAULT_TAGS)
            reader = args.reader or random.choice(DEFAULT_READERS)
            result = post_rfid(args.url, tag, reader)
            print(f"[{time.strftime('%H:%M:%S')}] {reader:<9} <- {tag:<16} {result}")
            if not args.loop:
                return 0
            time.sleep(args.interval)
    except urllib.error.URLError as e:
        print(f"Backend not reachable at {args.url}: {e.reason}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
