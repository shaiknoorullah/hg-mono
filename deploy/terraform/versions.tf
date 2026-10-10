terraform {
  required_version = ">= 1.7"
  required_providers {
    contabo = {
      source  = "contabo/contabo"
      version = "~> 0.1.44"
    }
    godaddy-dns = {
      source  = "veksh/godaddy-dns"
      version = "~> 0.3.12"
    }
  }
  # State stays outside the repository: terraform init -backend-config=path=$HOME/.config/halalgoes/terraform/hg.tfstate
  backend "local" {}
}
