"""Extract every enum the wire contract exposes, keyed by a stable path name."""
import os
import yaml

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
OPENAPI = os.path.join(REPO, "contracts", "openapi.yaml")


def contract_enums(path=OPENAPI):
    doc = yaml.safe_load(open(path))
    schemas = doc.get("components", {}).get("schemas", {})
    found = {}

    def walk(node, name):
        if isinstance(node, dict):
            if isinstance(node.get("enum"), list):
                found.setdefault(name, node["enum"])
            for k, v in node.items():
                if k == "enum":
                    continue
                walk(v, name + "/" + str(k))
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, name + "/" + str(i))

    for name, schema in schemas.items():
        walk(schema, name)
    return found
