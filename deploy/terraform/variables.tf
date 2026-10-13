# Credentials come from TF_VAR_* environment variables, never from a file in this repository.
variable "contabo_client_id" {
  type        = string
  sensitive   = true
  description = "Contabo API client id (customer control panel > Account > Security & Access > API). TF_VAR_contabo_client_id"
}
variable "contabo_client_secret" {
  type        = string
  sensitive   = true
  description = "Contabo API client secret. TF_VAR_contabo_client_secret"
}
variable "contabo_api_user" {
  type        = string
  sensitive   = true
  description = "Contabo API user: the account's login email. TF_VAR_contabo_api_user"
}
variable "contabo_api_password" {
  type        = string
  sensitive   = true
  description = "Contabo API password, set in the same panel page (not the login password). TF_VAR_contabo_api_password"
}
variable "godaddy_api_key" {
  type        = string
  sensitive   = true
  description = "GoDaddy production API key (developer.godaddy.com/keys). TF_VAR_godaddy_api_key"
}
variable "godaddy_api_secret" {
  type        = string
  sensitive   = true
  description = "GoDaddy API secret. TF_VAR_godaddy_api_secret"
}

variable "contabo_instance_id" {
  type        = string
  description = "The existing VPS's numeric Contabo instance id (the panel's VPS list, or: cntb get instances). Import only: nothing is created."
}

variable "domain" {
  type    = string
  default = "halalgoes.com"
}
variable "server_ipv4" {
  type    = string
  default = "13.140.57.152"
}
variable "hostnames" {
  type        = set(string)
  default     = ["api", "partner", "admin", "files"]
  description = "A records on the domain, all pointing at the one server."
}
variable "dns_ttl" {
  type    = number
  default = 600
}
