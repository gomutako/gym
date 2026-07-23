# AMI Ubuntu 24.04 ARM64 più recente (parametro pubblico Canonical via SSM)
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
}

# Security group: SSH ristretto, HTTP/HTTPS aperti
resource "aws_security_group" "gym" {
  name        = "gym-sg"
  description = "Gym Manager"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "gym-sg" }
}

# Istanza EC2 con bootstrap via cloud-init (riusa deploy/cloud-init.sh)
resource "aws_instance" "gym" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.gym.id]

  # Sostituisce il placeholder __REPO_URL__ nello script di bootstrap
  user_data = replace(
    file("${path.module}/../deploy/cloud-init.sh"),
    "__REPO_URL__",
    var.repo_url
  )

  root_block_device {
    volume_size = var.volume_size
    volume_type = "gp3"
  }

  tags = { Name = "gym-manager" }
}

# IP pubblico fisso
resource "aws_eip" "gym" {
  instance = aws_instance.gym.id
  domain   = "vpc"
  tags     = { Name = "gym-manager" }
}

# Record DNS opzionali (app + supabase) verso l'Elastic IP
resource "aws_route53_record" "app" {
  count   = var.create_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "${var.app_subdomain}.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.gym.public_ip]
}

resource "aws_route53_record" "supabase" {
  count   = var.create_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "${var.supabase_subdomain}.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.gym.public_ip]
}
