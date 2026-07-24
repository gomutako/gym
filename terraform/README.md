# Terraform — infrastruttura EC2

Provisioning riproducibile: security group (22/80/443), istanza EC2 (Ubuntu 24.04 x86_64,
`t3.micro` free tier, bootstrap via `deploy/cloud-init.sh`), Elastic IP e — opzionale —
record DNS Route53 per l'app.

L'istanza ospita **solo backend + Caddy**: il database è su **Supabase Cloud**, quindi
niente Docker né stack Supabase sul server.

## Uso
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # personalizza key_name, repo_url, ...
terraform init
terraform plan      # anteprima
terraform apply     # crea l'infrastruttura
```
Al termine ottieni `public_ip` e il comando SSH. Attendi 2-3 minuti che il cloud-init
finisca, poi prosegui con `DEPLOY.md` dal §3 (app: backend + frontend).

## Distruggere tutto
```bash
terraform destroy
```

## Note
- Richiede AWS CLI/credenziali configurate con permessi EC2 (+ Route53 se `create_dns=true`)
- Usa la **VPC di default** dell'account/regione
- Lo **stato** Terraform (`*.tfstate`) contiene dati sensibili: è gitignorato.
  Per team/produzione valuta un backend remoto (es. S3 + DynamoDB lock).
- Alternativa senza Terraform: `deploy/provision-ec2.sh` (AWS CLI).
