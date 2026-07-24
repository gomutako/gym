variable "aws_region" {
  description = "Regione AWS"
  type        = string
  default     = "eu-west-1"
}

variable "instance_type" {
  description = "Tipo istanza. t3.micro rientra nel free tier AWS (750h/mese per 12 mesi). L'istanza ospita solo backend + Caddy: il DB è su Supabase Cloud."
  type        = string
  default     = "t3.micro"
}

variable "volume_size" {
  description = "Dimensione disco root (GB, gp3). Il free tier AWS include 30 GB EBS."
  type        = number
  default     = 10
}

variable "key_name" {
  description = "Nome di una key pair EC2 esistente (per l'accesso SSH)"
  type        = string
}

variable "repo_url" {
  description = "URL git del progetto (pubblico, o gestisci un deploy key)"
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR autorizzato per SSH (22). Restringi al tuo IP per sicurezza."
  type        = string
  default     = "0.0.0.0/0"
}

# --- DNS opzionale (Route53) ---
variable "create_dns" {
  description = "Se true, crea i record A app/supabase in una hosted zone Route53"
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "ID della hosted zone Route53 (richiesto se create_dns=true)"
  type        = string
  default     = ""
}

variable "domain" {
  description = "Dominio radice, es. esempio.com (richiesto se create_dns=true)"
  type        = string
  default     = ""
}

variable "app_subdomain" {
  description = "Sottodominio dell'app (unico record necessario: il DB è su Supabase Cloud)"
  type        = string
  default     = "app"
}
