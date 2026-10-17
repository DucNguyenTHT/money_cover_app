# Forgotten admin password on the shop server: prints a new temporary password (must be changed at next login).
#   powershell -ExecutionPolicy Bypass -File scripts\reset-admin.ps1            (account "admin")
#   powershell -ExecutionPolicy Bypass -File scripts\reset-admin.ps1 -User chu  (another ADMIN account)
param(
  [string]$User = 'admin',
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env.prod')
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$compose = Join-Path $root 'docker-compose.prod.yml'
docker compose -f $compose --env-file $EnvFile exec -T api npx tsx prisma/seed/reset-admin.ts $User
if ($LASTEXITCODE -ne 0) { throw 'Không đặt lại được mật khẩu — xem thông báo phía trên' }
