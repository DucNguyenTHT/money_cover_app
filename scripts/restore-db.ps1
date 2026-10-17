# Restore a backup into the production database (REPLACES all current data).
#   powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1 -File backups\ketoan-20261012-0200.dump
# Stops the API while restoring, then starts it again.
param(
  [Parameter(Mandatory = $true)][string]$File,
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env.prod'),
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$compose = Join-Path $root 'docker-compose.prod.yml'
if (-not (Test-Path $File)) { throw "Không thấy file $File" }

if (-not $Yes) {
  $answer = Read-Host "Toàn bộ dữ liệu hiện tại sẽ bị thay bằng bản sao lưu $File. Gõ KHOIPHUC để tiếp tục"
  if ($answer -ne 'KHOIPHUC') { Write-Output 'Đã huỷ.'; exit 1 }
}

docker compose -f $compose --env-file $EnvFile stop api
$id = (docker compose -f $compose --env-file $EnvFile ps -q db).Trim()
docker cp (Resolve-Path $File) "${id}:/tmp/restore.dump"
docker compose -f $compose --env-file $EnvFile exec -T db pg_restore -U ketoan -d ketoan --clean --if-exists --no-owner /tmp/restore.dump
$code = $LASTEXITCODE
docker compose -f $compose --env-file $EnvFile exec -T db rm -f /tmp/restore.dump | Out-Null

# Invoice photos: put back any file missing from storage\documents (existing files are left untouched).
$docsBackup = Join-Path $root 'backups\documents'
if (Test-Path $docsBackup) {
  robocopy $docsBackup (Join-Path $root 'storage\documents') /E /XC /XN /XO /R:2 /W:5 /NP /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Warning "Không chép lại được ảnh chứng từ (robocopy mã $LASTEXITCODE)" }
  else { Write-Output 'Đã chép lại ảnh chứng từ còn thiếu từ backups\documents.' }
}

docker compose -f $compose --env-file $EnvFile start api
if ($code -ne 0) { throw "pg_restore báo lỗi (mã $code) — xem thông báo phía trên" }
Write-Output 'Khôi phục xong. Mở app và kiểm tra số liệu (đơn, tồn kho, báo cáo) của ngày gần nhất.'
