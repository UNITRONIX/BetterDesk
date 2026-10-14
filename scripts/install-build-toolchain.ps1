[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$VerifyOnly,
    [switch]$Unattended,
    [string]$ToolchainRoot = 'C:\ProgramData\BetterDesk\toolchain',
    [string]$FlutterVersion = '3.24.5',
    [string]$VcpkgCommit = '9e593bb18ea69cc5095e012465dcd675a822ed0d',
    [string]$BuildEnvFile = 'C:\ProgramData\BetterDesk\build.env'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
    Write-Host "[toolchain] $Message" -ForegroundColor Cyan
}

function Write-Warn([string]$Message) {
    Write-Warning "[toolchain] $Message"
}

function Require-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated PowerShell session.'
    }
}

function Test-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Invoke-WingetInstall([string]$Id, [string]$Override = '') {
    if (-not (Test-Command 'winget')) {
        throw "winget is required to install $Id. Install App Installer or provision the tools manually."
    }
    $arguments = @(
        'install', '--id', $Id, '--exact', '--source', 'winget',
        '--accept-package-agreements', '--accept-source-agreements'
    )
    if ($Override) {
        $arguments += @('--override', $Override)
    }
    Write-Info "Installing $Id"
    & winget @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "winget failed for $Id (exit $LASTEXITCODE)."
    }
    Refresh-ProcessPath
}

function Resolve-VsDevCmd {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) {
        return ''
    }
    $installation = (& $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null | Select-Object -First 1).Trim()
    if (-not $installation) {
        return ''
    }
    $candidate = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
    if (Test-Path -LiteralPath $candidate) {
        return $candidate
    }
    return ''
}

function Install-Flutter {
    $flutterRoot = Join-Path $ToolchainRoot "flutter-$FlutterVersion"
    $flutterExe = Join-Path $flutterRoot 'bin\flutter.bat'
    if (Test-Path -LiteralPath $flutterExe) {
        Write-Info "Flutter already installed at $flutterRoot"
        return $flutterRoot
    }

    $archive = Join-Path $env:TEMP "flutter_windows_$FlutterVersion-stable.zip"
    $url = "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_$FlutterVersion-stable.zip"
    $checksumUrl = "$url.sha256"
    Write-Info "Downloading Flutter $FlutterVersion"
    Invoke-WebRequest -Uri $url -OutFile $archive
    $checksumFile = "$archive.sha256"
    try {
        Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumFile
        $expected = (Get-Content -LiteralPath $checksumFile -Raw).Trim().Split(' ')[0].ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expected -notmatch '^[0-9a-f]{64}$' -or $actual -ne $expected) {
            throw 'Flutter archive checksum verification failed.'
        }
    } finally {
        Remove-Item -LiteralPath $checksumFile -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $ToolchainRoot -Force | Out-Null
    $extractRoot = Join-Path $env:TEMP "betterdesk-flutter-$([Guid]::NewGuid().ToString('N'))"
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot
    try {
        if (Test-Path -LiteralPath $flutterRoot) {
            throw "Flutter path exists but is incomplete: $flutterRoot"
        }
        Move-Item -LiteralPath (Join-Path $extractRoot 'flutter') -Destination $flutterRoot
    } finally {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    }
    return $flutterRoot
}

function Install-Vcpkg {
    $vcpkgRoot = Join-Path $ToolchainRoot 'vcpkg'
    $vcpkgExe = Join-Path $vcpkgRoot 'vcpkg.exe'
    if (-not (Test-Path -LiteralPath $vcpkgExe)) {
        if (Test-Path -LiteralPath $vcpkgRoot) {
            throw "vcpkg path exists but is incomplete: $vcpkgRoot"
        }
        Write-Info "Cloning pinned vcpkg commit $VcpkgCommit"
        git clone --filter=blob:none https://github.com/microsoft/vcpkg.git $vcpkgRoot
        git -C $vcpkgRoot fetch --depth 1 origin $VcpkgCommit
        git -C $vcpkgRoot checkout --detach $VcpkgCommit
        & (Join-Path $vcpkgRoot 'bootstrap-vcpkg.bat') -disableMetrics
        if ($LASTEXITCODE -ne 0) {
            throw "vcpkg bootstrap failed (exit $LASTEXITCODE)."
        }
    }
    return $vcpkgRoot
}

function Install-Rust {
    $cargoHome = Join-Path $ToolchainRoot 'cargo-home'
    $rustupHome = Join-Path $ToolchainRoot 'rustup-home'
    New-Item -ItemType Directory -Path $cargoHome, $rustupHome -Force | Out-Null
    $env:CARGO_HOME = $cargoHome
    $env:RUSTUP_HOME = $rustupHome
    if (-not (Test-Path -LiteralPath (Join-Path $cargoHome 'bin\cargo.exe'))) {
        if (-not (Test-Command 'rustup')) {
            throw 'rustup was not found after installation.'
        }
        & rustup toolchain install stable --profile minimal
        if ($LASTEXITCODE -ne 0) {
            throw "Rust toolchain installation failed (exit $LASTEXITCODE)."
        }
        & rustup default stable
        if ($LASTEXITCODE -ne 0) {
            throw "Rust default toolchain selection failed (exit $LASTEXITCODE)."
        }
    }
    return $cargoHome
}

function Write-BuildEnvironment(
    [string]$FlutterRoot,
    [string]$VcpkgRoot,
    [string]$VsDevCmd,
    [string]$CargoHome
) {
    $python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if (-not $python) {
        $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    }
    if (-not $python) {
        throw 'Python was not found after tool installation.'
    }
    $llvm = (Get-Command clang.exe -ErrorAction SilentlyContinue).Source
    $llvmRoot = if ($llvm) { Split-Path (Split-Path $llvm -Parent) -Parent } else { '' }
    $windowsSdk = ${env:WindowsSdkDir}
    if (-not $windowsSdk) {
        $windowsSdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
    }
    $cargo = Join-Path $CargoHome 'bin\cargo.exe'
    $rustupHome = Join-Path $ToolchainRoot 'rustup-home'
    $lines = @(
        '# Generated by install-build-toolchain.ps1',
        "BETTERDESK_CLIENT_TOOLCHAIN_ROOT=$ToolchainRoot",
        "CARGO_HOME=$CargoHome",
        "RUSTUP_HOME=$rustupHome",
        "BETTERDESK_CLIENT_CARGO=$cargo",
        "BETTERDESK_CLIENT_FLUTTER=$(Join-Path $FlutterRoot 'bin\flutter.bat')",
        "BETTERDESK_CLIENT_PYTHON=$python",
        "BETTERDESK_CLIENT_VSDEVCMD=$VsDevCmd",
        "BETTERDESK_CLIENT_WINDOWS_SDK_DIR=$windowsSdk",
        "BETTERDESK_CLIENT_LLVM_ROOT=$llvmRoot",
        "VCPKG_ROOT=$VcpkgRoot",
        "PATH=$(Join-Path $FlutterRoot 'bin');$(Split-Path $cargo -Parent);$(Split-Path $python -Parent);$env:Path"
    )
    New-Item -ItemType Directory -Path (Split-Path $BuildEnvFile -Parent) -Force | Out-Null
    Set-Content -LiteralPath $BuildEnvFile -Value $lines -Encoding UTF8
    Write-Info "Wrote $BuildEnvFile"
}

function Invoke-Verify {
    $missing = [System.Collections.Generic.List[string]]::new()
    $flutter = if ($env:BETTERDESK_CLIENT_FLUTTER) { $env:BETTERDESK_CLIENT_FLUTTER } else { Join-Path $ToolchainRoot "flutter-$FlutterVersion\bin\flutter.bat" }
    $vcpkg = if ($env:VCPKG_ROOT) { Join-Path $env:VCPKG_ROOT 'vcpkg.exe' } else { Join-Path $ToolchainRoot 'vcpkg\vcpkg.exe' }
    $cargo = if ($env:BETTERDESK_CLIENT_CARGO) {
        $env:BETTERDESK_CLIENT_CARGO
    } else {
        Join-Path $ToolchainRoot 'cargo-home\bin\cargo.exe'
    }
    $python = if ($env:BETTERDESK_CLIENT_PYTHON) { $env:BETTERDESK_CLIENT_PYTHON } else { (Get-Command python.exe -ErrorAction SilentlyContinue).Source }
    $vsDevCmd = if ($env:BETTERDESK_CLIENT_VSDEVCMD) { $env:BETTERDESK_CLIENT_VSDEVCMD } else { Resolve-VsDevCmd }
    $checks = [ordered]@{
        cargo = $cargo
        flutter = $flutter
        python = $python
        vcpkg = $vcpkg
        msvc = $vsDevCmd
        windows_sdk = if ($env:BETTERDESK_CLIENT_WINDOWS_SDK_DIR) {
            Join-Path $env:BETTERDESK_CLIENT_WINDOWS_SDK_DIR 'Include'
        } else {
            Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Include'
        }
    }
    foreach ($entry in $checks.GetEnumerator()) {
        if ($entry.Value -and (Test-Path -LiteralPath $entry.Value)) {
            Write-Host ("  OK   {0,-14} {1}" -f $entry.Key, $entry.Value) -ForegroundColor Green
        } else {
            $missing.Add($entry.Key)
            Write-Host ("  MISS {0,-14} {1}" -f $entry.Key, $entry.Value) -ForegroundColor Red
        }
    }
    if ($missing.Count) {
        throw "Windows builder toolchain is incomplete: $($missing -join ', ')"
    }
    Write-Info 'Windows x64/ARM64 local provider prerequisites are present.'
}

if (-not $Install -and -not $VerifyOnly) {
    Write-Host 'Usage: install-build-toolchain.ps1 -Install [-Unattended] or -VerifyOnly'
    exit 2
}

if ($Install) {
    Require-Administrator
    if (-not (Test-Command 'git')) {
        Invoke-WingetInstall 'Git.Git'
    }
    if (-not (Test-Command 'python')) {
        Invoke-WingetInstall 'Python.Python.3.12'
    }
    if (-not (Resolve-VsDevCmd)) {
        Invoke-WingetInstall 'Microsoft.VisualStudio.2022.BuildTools' `
            '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    }
    if (-not (Test-Command 'clang')) {
        Invoke-WingetInstall 'LLVM.LLVM'
    }
    if (-not (Test-Command 'rustup')) {
        Invoke-WingetInstall 'Rustlang.Rustup'
    }
    $flutterRoot = Install-Flutter
    $vcpkgRoot = Install-Vcpkg
    $cargoHome = Install-Rust
    $vsDevCmd = Resolve-VsDevCmd
    if (-not $vsDevCmd) {
        throw 'Visual Studio C++ workload or VsDevCmd.bat was not found.'
    }
    Write-BuildEnvironment $flutterRoot $vcpkgRoot $vsDevCmd $cargoHome
}

Invoke-Verify
