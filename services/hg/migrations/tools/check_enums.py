#!/usr/bin/env python3
"""
Verify every contract enum against a live database.

    DATABASE_URL=postgres://... python3 tools/check_enums.py

Exit 0 only when, for every enum in contracts/openapi.yaml, either
  * a Postgres enum type exists whose labels equal the contract's exactly
    (same values, same order), or
  * the enum is listed in tools/enum_map.py:EXCLUSIONS.
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enum_map import MAPPED, EXCLUSIONS          # noqa: E402
from openapi_enums import contract_enums         # noqa: E402

DSN = os.environ.get("DATABASE_URL", "postgres:///hg")


def db_enums():
    sql = (
        "SELECT coalesce(json_object_agg(typname, labels), '{}'::json) FROM ("
        "  SELECT t.typname AS typname,"
        "         json_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels"
        "    FROM pg_type t"
        "    JOIN pg_enum e ON e.enumtypid = t.oid"
        "    JOIN pg_namespace n ON n.oid = t.typnamespace"
        "   WHERE n.nspname = 'public'"
        "   GROUP BY t.typname) s"
    )
    raw = subprocess.check_output(["psql", DSN, "-At", "-c", sql], text=True)
    return json.loads(raw.strip())


def main():
    contract = contract_enums()
    live = db_enums()
    failures, matched = [], 0

    for name, values in sorted(contract.items()):
        if name in EXCLUSIONS:
            continue
        pg = MAPPED.get(name)
        if not pg:
            failures.append("%s: no pg type mapped and no exclusion recorded" % name)
            continue
        if pg not in live:
            failures.append("%s -> %s: type does not exist in the database" % (name, pg))
            continue
        want = [v for v in values if v is not None]
        got = live[pg]
        if want != got:
            failures.append(
                "%s -> %s: label mismatch\n    contract: %r\n    database: %r"
                % (name, pg, want, got)
            )
            continue
        matched += 1

    print("contract enums: %d total, %d matched to a pg type, %d excluded"
          % (len(contract), matched, len(EXCLUSIONS)))
    for name in sorted(EXCLUSIONS):
        print("  excluded  %-58s %s" % (name, EXCLUSIONS[name]))
    if failures:
        print("\nFAIL")
        for f in failures:
            print("  " + f)
        return 1
    print("\nOK: every contract enum is either an identical pg type or an explained exclusion.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
