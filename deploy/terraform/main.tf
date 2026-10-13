provider "contabo" {
  oauth2_client_id     = var.contabo_client_id
  oauth2_client_secret = var.contabo_client_secret
  oauth2_user          = var.contabo_api_user
  oauth2_pass          = var.contabo_api_password
}

provider "godaddy-dns" {
  api_key    = var.godaddy_api_key
  api_secret = var.godaddy_api_secret
}

# ---------------------------------------------------------------------------- the server
# The instance already exists (ordered in the Contabo panel on 4 Oct 2026). It is imported, never
# created or replaced by this configuration: everything that would force a new machine is
# ignored, and destroy is refused. What Terraform manages is its display name.
import {
  to = contabo_instance.prod
  id = var.contabo_instance_id
}

resource "contabo_instance" "prod" {
  display_name = "hg-prod"

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      image_id, ssh_keys, user_data, root_password, product_id, region, period,
      license, default_user, existing_instance_id, cancel_date,
    ]
  }
}

# ---------------------------------------------------------------------------- DNS (GoDaddy)
# One A record per public host, all to the one server. Imported if they already exist
# (import ids are domain:type:name); a missing one is created on apply.
import {
  for_each = var.hostnames
  to       = godaddy-dns_record.host[each.key]
  id       = "${var.domain}:A:${each.key}"
}

resource "godaddy-dns_record" "host" {
  for_each = var.hostnames

  domain = var.domain
  type   = "A"
  name   = each.key
  data   = var.server_ipv4
  ttl    = var.dns_ttl
}
