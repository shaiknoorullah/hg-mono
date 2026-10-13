output "server_ipv4" {
  value = var.server_ipv4
}
output "hostnames" {
  value = [for h in sort(tolist(var.hostnames)) : "${h}.${var.domain}"]
}
