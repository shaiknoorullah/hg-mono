"""
Schema-driven value synthesis.

Every fixture in `contracts/fixtures/` is produced by walking the actual schema out of
`contracts/openapi.yaml` and filling it in. Nothing is typed out by hand against a
remembered field list, which is why a fixture cannot drift from the contract: if a field is
added, removed or retyped, the next `pnpm fixtures:build` picks it up.

Realism comes from `content.py` — a property-name keyed dictionary of Ontario addresses,
CAD cents, +1 numbers and halal restaurant/dish names — not from the schema.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # matches ^[0-9A-HJKMNP-TV-Z]{26}$

DELETE = object()  # sentinel: remove this key entirely


def _digest(label: str) -> bytes:
    return hashlib.sha256(label.encode("utf-8")).digest()


def uuid_for(label: str) -> str:
    """Deterministic RFC-4122-shaped UUID. Same label always yields the same id, so a
    fixture's `restaurant_id` matches the restaurant fixture's `id` across files."""
    h = _digest("uuid:" + label).hex()
    return f"{h[0:8]}-{h[8:12]}-4{h[13:16]}-a{h[17:20]}-{h[20:32]}"


def ulid_for(label: str) -> str:
    """Deterministic ULID matching `^[0-9A-HJKMNP-TV-Z]{26}$`."""
    h = _digest("ulid:" + label)
    out = []
    for i in range(26):
        out.append(ULID_ALPHABET[h[i % len(h)] % 32])
    return "".join(out)


def int_for(label: str, lo: int, hi: int) -> int:
    span = hi - lo + 1
    return lo + int.from_bytes(_digest("int:" + label)[:8], "big") % span


class Synth:
    """Produces a schema-valid instance of any component schema."""

    def __init__(self, spec: dict, content: "Content") -> None:
        self.spec = spec
        self.schemas = spec["components"]["schemas"]
        self.content = content

    # ---------------------------------------------------------------- refs --

    def deref(self, schema: dict) -> dict:
        seen = 0
        while isinstance(schema, dict) and "$ref" in schema:
            ref = schema["$ref"]
            assert ref.startswith("#/"), ref
            node: Any = self.spec
            for part in ref[2:].split("/"):
                node = node[part]
            schema = node
            seen += 1
            if seen > 32:
                raise RuntimeError(f"ref cycle at {ref}")
        return schema

    def ref_name(self, schema: dict) -> str | None:
        ref = schema.get("$ref")
        if not ref:
            return None
        return ref.rsplit("/", 1)[-1]

    # ----------------------------------------------------------- entrypoint --

    def make(self, schema_name: str, label: str, *, optionals: bool = True) -> Any:
        return self.gen(
            {"$ref": f"#/components/schemas/{schema_name}"},
            label=label,
            prop=None,
            optionals=optionals,
        )

    # ------------------------------------------------------------ generator --

    def gen(self, schema: dict, label: str, prop: str | None, optionals: bool) -> Any:
        name = self.ref_name(schema)
        schema = self.deref(schema)

        # A named scalar wrapper (Cents, Ulid, Timestamp, PhoneE164, …) carries the
        # semantics that the raw type does not.
        if name:
            override = self.content.by_schema(name, label, prop)
            if override is not _MISS:
                return override

        if "allOf" in schema:
            merged: dict[str, Any] = {}
            for branch in schema["allOf"]:
                part = self.gen(branch, label, prop, optionals)
                if isinstance(part, dict):
                    merged.update(part)
            return merged

        if "oneOf" in schema:
            branches = [b for b in schema["oneOf"] if self.deref(b).get("type") != "null"]
            if not branches:
                return None
            return self.gen(branches[0], label, prop, optionals)

        if "anyOf" in schema:
            return self.gen(schema["anyOf"][0], label, prop, optionals)

        if "enum" in schema:
            members = [m for m in schema["enum"] if m is not None]
            chosen = self.content.enum_choice(name, prop, members, label)
            return chosen

        types = schema.get("type")
        if isinstance(types, list):
            non_null = [t for t in types if t != "null"]
            t = non_null[0] if non_null else "null"
        else:
            t = types

        if t == "object" or (t is None and "properties" in schema):
            return self._gen_object(schema, label, optionals)
        if t == "array":
            return self._gen_array(schema, label, prop, optionals)
        if t == "boolean":
            return self.content.boolean(prop, label)
        if t == "integer":
            return self._gen_integer(schema, label, prop)
        if t == "number":
            return self._gen_number(schema, label, prop)
        if t == "string":
            return self._gen_string(schema, label, prop)
        if t == "null":
            return None
        # untyped / free-form
        return {}

    def _gen_object(self, schema: dict, label: str, optionals: bool) -> dict:
        required = set(schema.get("required", []))
        props: dict = schema.get("properties") or {}
        out: dict[str, Any] = {}
        for key, sub in props.items():
            if not optionals and key not in required:
                continue
            value = self.gen(sub, f"{label}.{key}", key, optionals)
            if value is DELETE:
                continue
            out[key] = value
        return out

    def _gen_array(self, schema: dict, label: str, prop: str | None, optionals: bool) -> list:
        item_schema = schema.get("items")
        if item_schema is None:
            return []
        count = self.content.array_size(prop, schema, label)
        return [
            self.gen(item_schema, f"{label}[{i}]", prop, optionals) for i in range(count)
        ]

    def _gen_integer(self, schema: dict, label: str, prop: str | None) -> int:
        override = self.content.integer(prop, schema, label)
        if override is not _MISS:
            value = override
        else:
            lo = schema.get("minimum", 0)
            hi = schema.get("maximum", max(lo + 20, 20))
            value = int_for(label, int(lo), int(hi))
        lo = schema.get("minimum")
        hi = schema.get("maximum")
        if lo is not None:
            value = max(int(lo), value)
        if hi is not None:
            value = min(int(hi), value)
        return int(value)

    def _gen_number(self, schema: dict, label: str, prop: str | None) -> float:
        override = self.content.number(prop, schema, label)
        if override is not _MISS:
            return override
        lo = schema.get("minimum", 0)
        hi = schema.get("maximum", 100)
        return round(lo + (int_for(label, 0, 1000) / 1000) * (hi - lo), 4)

    def _gen_string(self, schema: dict, label: str, prop: str | None) -> str:
        # `format` and `pattern` are assertions the fixture must satisfy, so they win over
        # the name-keyed realism table. A prose value for a `format: uuid` field would be a
        # nicer-looking fixture that does not validate, which is worth nothing.
        fmt = schema.get("format")
        if fmt == "uuid":
            return uuid_for(label)
        if fmt == "date-time":
            return self.content.timestamp(prop, label)
        if fmt == "date":
            return self.content.date(prop, label)
        if fmt == "uri":
            return self.content.image_url(prop, label)
        if fmt == "email":
            return self.content.email(prop, label)

        pattern = schema.get("pattern")
        if pattern:
            return self._from_pattern(pattern, label)

        override = self.content.string(prop, schema, label)
        if override is not _MISS:
            return self._fit(override, schema)

        base = self.content.generic_string(prop, label)
        return self._fit(base, schema)

    def _fit(self, value: str, schema: dict) -> str:
        max_len = schema.get("maxLength")
        min_len = schema.get("minLength")
        if max_len is not None and len(value) > max_len:
            value = value[:max_len].rstrip()
        if min_len is not None and len(value) < min_len:
            value = (value + "-" * min_len)[:min_len]
        return value

    # Candidate values tried against any `pattern` in the contract. The first that
    # `re.fullmatch`es wins, so the same pool serves `^\\d{9}RT\\d{4}$` and
    # `^[0-9]{9}RT[0-9]{4}$` without caring which spelling the contract used.
    _PATTERN_CANDIDATES: tuple[str, ...] = (
        "+14165550142",
        "11:00",
        "4242",
        "812345678RT0001",
        "M4J 1M4",
        "CA",
        "ON",
        "CAD",
        "en-CA",
        "America/Toronto",
        "HG-4K2M-9T",
        "2026-08-10",
        "1.4.0",
        "hg.v1",
        "visa",
        "CJHK812",
        "halalgoes",
    )

    def _from_pattern(self, pattern: str, label: str) -> str:
        if pattern == r"^[0-9A-HJKMNP-TV-Z]{26}$":
            return ulid_for(label)
        if "A-CEGHJ-NPR-TVXY" in pattern:  # Canadian postal code
            return self.content.postal_code(label)
        compiled = re.compile(pattern)
        for candidate in self._PATTERN_CANDIDATES:
            if compiled.search(candidate) and (
                not pattern.startswith("^") or compiled.fullmatch(candidate)
            ):
                return candidate
        raise RuntimeError(
            f"no sample matches pattern {pattern!r} at {label} — add one to "
            "Synth._PATTERN_CANDIDATES"
        )


class _Miss:
    def __repr__(self) -> str:  # pragma: no cover
        return "<no override>"


_MISS = _Miss()
MISS = _MISS


def deep_merge(base: Any, patch: Any) -> Any:
    """Overlay `patch` onto `base`. `DELETE` removes a key; a list in `patch` replaces
    the list in `base` outright (lists are ordered payloads, not sets)."""
    if patch is DELETE:
        return DELETE
    if isinstance(base, dict) and isinstance(patch, dict):
        out = dict(base)
        for k, v in patch.items():
            if v is DELETE:
                out.pop(k, None)
            elif k in out:
                merged = deep_merge(out[k], v)
                if merged is DELETE:
                    out.pop(k, None)
                else:
                    out[k] = merged
            else:
                out[k] = v
        return out
    return patch
