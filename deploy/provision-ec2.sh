#!/usr/bin/env bash
# =====================================================
# Provisioning EC2 (UNA TANTUM) via AWS CLI.
# Crea security group (22/80/443) e lancia un'istanza con l'AMI Ubuntu 24.04 ARM,
# usando deploy/cloud-init.sh come user-data (bootstrap automatico al primo avvio).
#
# Prerequisiti: AWS CLI configurato (`aws configure`) con permessi EC2 + SSM,
#               e una key pair EC2 già esistente (per l'SSH).
#
# Uso:
#   KEY_NAME=la-mia-key REPO_URL=https://github.com/tuo/gym.git ./deploy/provision-ec2.sh
# =====================================================
set -euo pipefail

: "${AWS_REGION:=eu-west-1}"
: "${INSTANCE_TYPE:=t3.micro}"     # free tier AWS. L'istanza ospita solo backend + Caddy
: "${VOLUME_SIZE:=10}"
: "${SG_NAME:=gym-sg}"
: "${TAG_NAME:=gym-manager}"
: "${KEY_NAME:?Imposta KEY_NAME = nome di una key pair EC2 esistente}"
: "${REPO_URL:?Imposta REPO_URL = URL git del progetto (pubblico, o gestisci un deploy key)}"

command -v aws >/dev/null || { echo "❌ AWS CLI non installato/configurato"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "▶ Ultima AMI Ubuntu 24.04 x86_64 in $AWS_REGION…"
AMI=$(aws ssm get-parameters --region "$AWS_REGION" \
  --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query 'Parameters[0].Value' --output text)
echo "  AMI = $AMI"

echo "▶ Security group ($SG_NAME)…"
SG=$(aws ec2 describe-security-groups --region "$AWS_REGION" \
  --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ -z "$SG" ] || [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --region "$AWS_REGION" \
    --group-name "$SG_NAME" --description "Gym Manager" --query GroupId --output text)
  for p in 22 80 443; do
    aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
      --group-id "$SG" --protocol tcp --port "$p" --cidr 0.0.0.0/0 >/dev/null
  done
  echo "  creato $SG (aperte 22/80/443)"
else
  echo "  esistente $SG"
fi

echo "▶ Preparo user-data da cloud-init.sh…"
USER_DATA=$(sed "s#__REPO_URL__#$REPO_URL#g" "$HERE/cloud-init.sh")

echo "▶ Lancio istanza $INSTANCE_TYPE…"
IID=$(aws ec2 run-instances --region "$AWS_REGION" \
  --image-id "$AMI" --instance-type "$INSTANCE_TYPE" --key-name "$KEY_NAME" \
  --security-group-ids "$SG" \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$VOLUME_SIZE,VolumeType=gp3}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$TAG_NAME}]" \
  --user-data "$USER_DATA" \
  --query 'Instances[0].InstanceId' --output text)
echo "  istanza $IID in avvio…"

aws ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$IID"
IP=$(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

cat <<EOF

✅ Istanza pronta
   ID:  $IID
   IP:  $IP
   SSH: ssh -i <tua-chiave.pem> ubuntu@$IP

Il cloud-init (2-3 min) installa Node/Caddy, crea l'utente 'gym' e clona il repo in /opt/gym.
Prossimi passi:
  1) (consigliato) alloca un Elastic IP e associalo all'istanza, così l'IP non cambia
  2) punta il record DNS 'app' a $IP
  3) segui DEPLOY.md (progetto Supabase Cloud + .env + Caddy + servizio backend)
EOF
