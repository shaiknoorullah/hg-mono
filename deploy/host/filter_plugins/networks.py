"""Docker network helper for the HalalGoes playbooks.

`hg_overlapping_subnets` takes a mapping of network name to subnet and returns every pair
whose subnets overlap, as "a (subnet) and b (subnet)" strings, so the docker role can refuse
to create networks that would clash with each other or with the ones the production compose
project creates. An empty list means none overlap.
"""

import ipaddress
from itertools import combinations

from ansible.errors import AnsibleFilterError


def hg_overlapping_subnets(subnets):
    try:
        parsed = [(name, ipaddress.ip_network(str(cidr), strict=True)) for name, cidr in dict(subnets).items()]
    except ValueError as exc:
        raise AnsibleFilterError(f"hg_overlapping_subnets: {exc}") from exc
    return [
        f"{a} ({net_a}) and {b} ({net_b})"
        for (a, net_a), (b, net_b) in combinations(parsed, 2)
        if net_a.version == net_b.version and net_a.overlaps(net_b)
    ]


class FilterModule:
    def filters(self):
        return {"hg_overlapping_subnets": hg_overlapping_subnets}
