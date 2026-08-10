#!/usr/bin/env python3
"""
Regenerate every fixture under `contracts/fixtures/`.

    pnpm fixtures:build      # from the repo root
    python3 contracts/fixtures/_build/build.py

Output is deterministic — same contract in, byte-identical fixtures out — so
`git diff --exit-code` is a meaningful CI check. Nothing under `contracts/fixtures/` may be
hand-edited; edit the builder instead.
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import yaml  # noqa: E402

import dom_catalogue  # noqa: E402
import dom_errors  # noqa: E402
import dom_onboarding  # noqa: E402
import dom_orders  # noqa: E402
import dom_rider  # noqa: E402
from content import Content  # noqa: E402
from readme import write_readme  # noqa: E402
from registry import Registry  # noqa: E402
from synth import Synth  # noqa: E402

CONTRACT = os.path.abspath(os.path.join(HERE, "..", "..", "openapi.yaml"))


def main() -> int:
    with open(CONTRACT, encoding="utf-8") as fh:
        spec = yaml.safe_load(fh)

    synth = Synth(spec, Content())
    reg = Registry()

    dom_catalogue.build(reg, synth)
    dom_orders.build(reg, synth)
    dom_rider.build(reg, synth)
    dom_onboarding.build(reg, synth)
    dom_errors.build(reg, synth)

    manifest = reg.write()
    write_readme(manifest)

    print(f"wrote {manifest['count']} fixtures")
    for domain, count in manifest["counts_by_domain"].items():
        print(f"  {domain:<12} {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
