param(
  [string]$TaskName = "AI News Catchup Daily Update"
)

$ErrorActionPreference = "Stop"

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (-not $Task) {
  Write-Host "Scheduled task was not found: $TaskName"
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task: $TaskName"
