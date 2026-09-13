'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const INSTALLER_SCRIPT = String.raw`[CmdletBinding()]
param(
    [switch]$UseScheduledTask
)

$ErrorActionPreference = 'Stop'
$app = @(
    (Join-Path $PSScriptRoot 'betterdesk.exe'),
    (Join-Path $PSScriptRoot 'rustdesk.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $app) {
    throw 'BetterDesk executable was not found next to this installer.'
}

$appName = [IO.Path]::GetFileNameWithoutExtension($app)
$serviceName = $appName
$taskName = "$appName Tray"
$startupShortcut = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Startup\$appName Tray.lnk"
$isUninstall = [IO.Path]::GetFileNameWithoutExtension($MyInvocation.MyCommand.Name) -match 'Uninstall'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdministrator) {
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        $MyInvocation.MyCommand.Path
    )
    if ($UseScheduledTask) {
        $arguments += '-UseScheduledTask'
    }
    $elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $elevated.ExitCode
}

if ($isUninstall) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $app) {
        $process = Start-Process -FilePath $app -ArgumentList '--uninstall-service' -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) {
            throw "BetterDesk service uninstall failed with exit code $($process.ExitCode)."
        }
    }
    exit 0
}

$process = Start-Process -FilePath $app -ArgumentList '--install-service' -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) {
    throw "BetterDesk service installation failed with exit code $($process.ExitCode)."
}
$service = Get-Service -Name $serviceName -ErrorAction Stop
if ($service.Status -notin @('Running', 'StartPending')) {
    throw "BetterDesk service is not running (status: $($service.Status))."
}

if ($UseScheduledTask) {
    Remove-Item -LiteralPath $startupShortcut -Force -ErrorAction SilentlyContinue
    $taskAction = New-ScheduledTaskAction -Execute $app -Argument '--tray' -WorkingDirectory (Split-Path -Parent $app)
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType InteractiveToken -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
}

Write-Host "BetterDesk service installed successfully."
`;

function buildWindowsSupportInstallerScript() {
    return INSTALLER_SCRIPT;
}

async function writeWindowsSupportInstallers(stageDir) {
    const script = buildWindowsSupportInstallerScript();
    await fsp.writeFile(path.join(stageDir, 'Install-BetterDesk.ps1'), script, 'utf8');
    await fsp.writeFile(path.join(stageDir, 'Uninstall-BetterDesk.ps1'), script, 'utf8');
}

function hasWindowsSupportInstallers(stageDir) {
    return [
        'Install-BetterDesk.ps1',
        'Uninstall-BetterDesk.ps1',
    ].every((name) => fs.existsSync(path.join(stageDir, name)));
}

module.exports = {
    buildWindowsSupportInstallerScript,
    writeWindowsSupportInstallers,
    hasWindowsSupportInstallers,
};
