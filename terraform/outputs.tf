output "instance_id" {
  description = "ID dell'istanza EC2"
  value       = aws_instance.gym.id
}

output "public_ip" {
  description = "IP pubblico fisso (Elastic IP)"
  value       = aws_eip.gym.public_ip
}

output "ssh" {
  description = "Comando SSH"
  value       = "ssh -i <tua-chiave.pem> ubuntu@${aws_eip.gym.public_ip}"
}

output "dns_hint" {
  description = "Se non usi Route53, punta questi record A all'IP"
  value       = var.create_dns ? "Record Route53 creati" : "Crea manualmente: ${var.app_subdomain}.<dominio> e ${var.supabase_subdomain}.<dominio> -> ${aws_eip.gym.public_ip}"
}
