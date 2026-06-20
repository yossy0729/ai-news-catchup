param(
  [string]$TaskName = "AI News Catchup Daily Update",
  [string]$At = "07:00",
  [string]$NodePath = "",
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$UpdateScript = Join-Path $Root "scripts\daily-update.js"

if (-not (Test-Path -LiteralPath $UpdateScript)) {
  throw "daily-update.js was not found: $UpdateScript"
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $Command = Get-Command node -ErrorAction Stop
  $NodePath = $Command.Source
}

if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "node.exe was not found: $NodePath"
}

$TriggerTime = [datetime]::ParseExact($At, "HH:mm", $null)
$Action = New-ScheduledTaskAction `
  -Execute $NodePath `
  -Argument "`"$UpdateScript`"" `
  -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited
$Description = "Runs AI News Catchup daily update from $Root"

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description $Description `
  -Force | Out-Null

$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Schedule: daily at $At"
Write-Host "Node: $NodePath"
Write-Host "Script: $UpdateScript"
Write-Host "State: $($Task.State)"
Write-Host "Next run: $($Info.NextRunTime)"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started task now."
}
