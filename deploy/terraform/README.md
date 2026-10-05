# Terraform: the Contabo server and its DNS records

What exists today, written down: the Contabo VPS (Mumbai) and four A records at GoDaddy (`api`, `partner`, `admin`, `files` on `halalgoes.com`, all to `13.140.57.152`). Nothing here is applied yet: it needs the owner's credentials.

| Provider | Status |
|---|---|
| [`contabo/contabo`](https://registry.terraform.io/providers/contabo/contabo) 0.1.44 | the vendor's own, maintained. The instance is **imported, never created**: every attribute that would replace the machine is ignored and `prevent_destroy` is on. Terraform manages only its display name |
| [`veksh/godaddy-dns`](https://registry.terraform.io/providers/veksh/godaddy-dns) 0.3.12 | maintained (the older `n3integration/godaddy` was last released in December 2022). Only the A records are managed; other records on the domain are left alone |

**Gap to know about:** GoDaddy's API is available only to accounts with enough domains or a paid plan; if the key request is refused, the records stay managed by hand in GoDaddy's panel and only the Contabo half of this configuration is used (remove the `godaddy-dns` blocks).

State is a local file outside the repository: `~/.config/halalgoes/terraform/hg.tfstate`. Credentials are `TF_VAR_*` environment variables, never files in the repository (`*.tfvars` is ignored).

## Owner steps

1. **Contabo API**, in the customer control panel under Account, Security & Access, API: note the client id and client secret, and set an API password (separate from the login password). The API user is the account's login email. The instance id is the number in the VPS list (or `cntb get instances`).
2. **GoDaddy API**: create a *production* key at <https://developer.godaddy.com/keys>.
3. Then, from this folder:

```bash
export TF_VAR_contabo_client_id=... TF_VAR_contabo_client_secret=... \
       TF_VAR_contabo_api_user=you@example.com TF_VAR_contabo_api_password=... \
       TF_VAR_godaddy_api_key=... TF_VAR_godaddy_api_secret=... \
       TF_VAR_contabo_instance_id=<numeric instance id>
export TF_DATA_DIR=$HOME/.config/halalgoes/terraform/.data
terraform init -backend-config=path=$HOME/.config/halalgoes/terraform/hg.tfstate
terraform validate
terraform plan        # expect: 1 import (instance) + 4 imports (records), 0 to add or destroy
terraform apply       # only after the plan shows no create/replace/destroy
```

If the plan wants to *replace* the instance or change a record's address, stop: the configuration and reality differ, and nothing should be applied until that is understood. The record import ids are `halalgoes.com:A:<name>`; if the provider rejects that form, `terraform import 'godaddy-dns_record.host["api"]' <id>` with the form its error message shows.

`terraform init` and `terraform validate` have been run with Terraform 1.15.9 and pass (provider versions are locked in `.terraform.lock.hcl`).
