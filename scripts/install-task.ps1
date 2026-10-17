# Register the nightly backup (02:00) in Windows Task Scheduler. Run once, as Administrator.
#   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
param([string]$At = '02:00')
$ErrorActionPreference = 'Stop'
$script = Resolve-Path (Join-Path $PSScriptRoot 'backup-db.ps1')
$log = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) 'backups\backup.log'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"& '$script' *>> '$log'`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
# Run even if the machine was off at 02:00 (runs at next start-up).
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'KetoanBackup' -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
Write-Output "Đã cài lịch sao lưu hằng ngày lúc $At (task: KetoanBackup). Nhật ký: $log"
