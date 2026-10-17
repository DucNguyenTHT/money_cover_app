# Nightly database backup for the shop server.
#   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
# Keeps the newest 30 dumps in .\backups and copies each new one to BACKUP_COPY_DIR (from .env.prod) if set.
param(
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env.prod'),
  [int]$Keep = 30
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$compose = Join-Path $root 'docker-compose.prod.yml'
$dir = Join-Path $root 'backups'
New-Item -ItemType Directory -Force $dir | Out-Null

$copyDir = $null
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*BACKUP_COPY_DIR\s*=\s*(.+)\s*$') { $copyDir = $Matches[1].Trim() }
  }
}

$file = Join-Path $dir ("ketoan-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
# pg_dump custom format (compressed, restorable table by table). Written inside the container, then copied out
# so PowerShell never touches the binary stream.
docker compose -f $compose --env-file $EnvFile exec -T db pg_dump -U ketoan -d ketoan -Fc -f /tmp/backup.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump thất bại' }
$id = (docker compose -f $compose --env-file $EnvFile ps -q db).Trim()
docker cp "${id}:/tmp/backup.dump" $file
if ($LASTEXITCODE -ne 0) { throw 'Không chép được file sao lưu ra máy' }
docker compose -f $compose --env-file $EnvFile exec -T db rm -f /tmp/backup.dump | Out-Null

$size = (Get-Item $file).Length
if ($size -lt 1024) { throw "File sao lưu quá nhỏ ($size bytes) — kiểm tra lại" }
Write-Output "Đã sao lưu: $file ($([math]::Round($size / 1KB)) KB)"

if ($copyDir) {
  New-Item -ItemType Directory -Force $copyDir | Out-Null
  Copy-Item $file $copyDir
  Write-Output "Đã chép sang: $copyDir"
}

# Invoice photos (Chứng từ): copy only new files, never delete anything in the copies (/E, no /MIR or /PURGE),
# so a file removed by mistake on the server is still in the backup.
$docs = Join-Path $root 'storage\documents'
if (Test-Path $docs) {
  $targets = @(Join-Path $dir 'documents')
  if ($copyDir) { $targets += Join-Path $copyDir 'documents' }
  foreach ($t in $targets) {
    robocopy $docs $t /E /XO /XF *.tmp /R:2 /W:5 /NP /NFL /NDL /NJH /NJS | Out-Null
    # robocopy: 0-7 = success (1 = files copied), 8+ = failure.
    if ($LASTEXITCODE -ge 8) { throw "Không chép được ảnh chứng từ sang $t (robocopy mã $LASTEXITCODE)" }
    Write-Output "Đã chép ảnh chứng từ sang: $t"
  }
  $global:LASTEXITCODE = 0
}

Get-ChildItem $dir -Filter 'ketoan-*.dump' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item
