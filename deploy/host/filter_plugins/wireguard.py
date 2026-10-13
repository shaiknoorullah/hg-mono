"""WireGuard key helper for the HalalGoes playbooks.

`hg_wg_pubkey` turns a base64 WireGuard private key into its public key, on the machine
that runs Ansible, so templates can name a server's public key without running `wg` on it
(which a fresh server, or check mode, does not have yet). Same result as `wg pubkey`.
"""

import base64

from ansible.errors import AnsibleFilterError


def hg_wg_pubkey(private_key):
    try:
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    except ImportError as exc:  # ansible-core depends on cryptography, so this is rare
        raise AnsibleFilterError("hg_wg_pubkey needs the Python 'cryptography' package") from exc
    try:
        raw = base64.b64decode(str(private_key).strip(), validate=True)
    except ValueError as exc:
        raise AnsibleFilterError("hg_wg_pubkey: the private key is not base64") from exc
    if len(raw) != 32:
        raise AnsibleFilterError("hg_wg_pubkey: a WireGuard key is 32 bytes")
    public = X25519PrivateKey.from_private_bytes(raw).public_key()
    return base64.b64encode(public.public_bytes(Encoding.Raw, PublicFormat.Raw)).decode("ascii")


class FilterModule:
    def filters(self):
        return {"hg_wg_pubkey": hg_wg_pubkey}
