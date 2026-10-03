<#
.SYNOPSIS
    BetterDesk Server - Interactive Build Script for Windows

.DESCRIPTION
    This script automates building BetterDesk enhanced binaries from source.
    It handles downloading RustDesk sources, applying BetterDesk modifications,
    and compiling the final binaries.

.PARAMETER Auto
    Non-interactive mode (use default settings)

.PARAMETER Clean
    Clean build directory and exit

.PARAMETER Version
    Specify RustDesk version (default: 1.1.14)

.EXAMPLE
    .\build-betterdesk.ps1
    Interactive build

.EXAMPLE
    .\build-betterdesk.ps1 -Auto
    Build with defaults

.EXAMPLE
    .\build-betterdesk.ps1 -Version 1.1.15
    Build specific version
#>

param(
    [switch]$Auto,
    [switch]$Clean,
    [string]$Version = "",
    [switch]$Help
)

# ============================================================================
# Configuration
# ============================================================================

$Script:ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:BuildDir = Join-Path $Script:ScriptDir "build"
$Script:PatchesDir = Join-Path $Script:ScriptDir "hbbs-patch-v2\src"
$Script:OutputDir = Join-Path $Script:ScriptDir "hbbs-patch-v2"

$Script:DefaultRustDeskVersion = "1.1.14"
$Script:RustDeskRepo = "https://github.com/rustdesk/rustdesk-server.git"

$Script:RustDeskVersion = ""
$Script:TargetPlatform = "windows-x64"

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host "  ========================================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "  ========================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Error2 {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Warning2 {
    param([string]$Message)
    Write-Host "[WARNING] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Step {
    param([string]$Message)
    Write-Host ">> " -ForegroundColor Magenta -NoNewline
    Write-Host $Message
}

function Show-HelpMessage {
    Write-Host "BetterDesk Server - Build Script"
    Write-Host ""
    Write-Host "Usage: .\build-betterdesk.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Auto          Non-interactive mode (use default settings)"
    Write-Host "  -Clean         Clean build directory and exit"
    Write-Host "  -Version VER   Specify RustDesk version (default: $Script:DefaultRustDeskVersion)"
    Write-Host "  -Help          Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\build-betterdesk.ps1                 # Interactive build"
    Write-Host "  .\build-betterdesk.ps1 -Auto           # Build with defaults"
    Write-Host "  .\build-betterdesk.ps1 -Version 1.1.15 # Build specific version"
    Write-Host ""
}

# ============================================================================
# Dependency Checks
# ============================================================================

function Check-Dependencies {
    Write-Header "Checking Dependencies"
    
    $missing = 0
    
    # Check Rust
    $cargoCmd = Get-Command cargo -ErrorAction SilentlyContinue
    if ($cargoCmd) {
        $rustVersion = & rustc --version 2>&1
        Write-Success "Rust/Cargo: $rustVersion"
    } else {
        Write-Error2 "Rust/Cargo not found"
        Write-Host "  Install from: https://rustup.rs"
        $missing++
    }
    
    # Check Git
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) {
        $gitVersion = & git --version 2>&1
        Write-Success "Git: $gitVersion"
    } else {
        Write-Error2 "Git not found"
        Write-Host "  Install from: https://git-scm.com/download/win"
        $missing++
    }
    
    # Check Visual Studio Build Tools
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        $vsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
        if ($vsPath) {
            Write-Success "Visual Studio Build Tools found"
        } else {
            Write-Warning2 "Visual Studio C++ tools may not be installed"
            Write-Host "  Install Visual Studio Build Tools with C++ support"
        }
    } else {
        Write-Warning2 "vswhere not found - cannot verify Visual Studio"
    }
    
    # Check CMake (optional but helpful)
    $cmakeCmd = Get-Command cmake -ErrorAction SilentlyContinue
    if ($cmakeCmd) {
        $cmakeVersion = & cmake --version 2>&1 | Select-Object -First 1
        Write-Success "CMake: $cmakeVersion"
    } else {
        Write-Info "CMake not found (optional for some builds)"
    }
    
    if ($missing -gt 0) {
        Write-Host ""
        Write-Error2 "Missing dependencies. Please install them first."
        Write-Host ""
        Write-Host "Quick install:" -ForegroundColor Yellow
        Write-Host "  1. Install Rust from https://rustup.rs"
        Write-Host "  2. Install Git from https://git-scm.com/download/win"
        Write-Host "  3. Install Visual Studio Build Tools with C++ workload"
        Write-Host ""
        return $false
    }
    
    Write-Success "All dependencies satisfied!"
    return $true
}

# ============================================================================
# Interactive Configuration
# ============================================================================

function Interactive-Config {
    Write-Header "Build Configuration"
    
    # Select RustDesk version
    Write-Host "Available RustDesk versions:" -ForegroundColor White
    Write-Host "  1) 1.1.14 (stable, recommended)"
    Write-Host "  2) 1.1.13 (older stable)"
    Write-Host "  3) Custom (enter version)"
    Write-Host ""
    
    if ($Auto) {
        $Script:RustDeskVersion = $Script:DefaultRustDeskVersion
        Write-Info "Auto mode: Using version $Script:RustDeskVersion"
    } else {
        $versionChoice = Read-Host "Select version [1]"
        switch ($versionChoice) {
            "2" { $Script:RustDeskVersion = "1.1.13" }
            "3" { 
                $Script:RustDeskVersion = Read-Host "Enter version (e.g., 1.1.15)"
            }
            default { $Script:RustDeskVersion = $Script:DefaultRustDeskVersion }
        }
    }
    
    Write-Success "Selected RustDesk version: $Script:RustDeskVersion"
    Write-Host ""
    
    # Target platform is always Windows x64 on Windows
    $Script:TargetPlatform = "windows-x64"
    Write-Success "Target platform: $Script:TargetPlatform"
    Write-Host ""
    
    # Confirm
    if (-not $Auto) {
        Write-Host "Build Summary:" -ForegroundColor White
        Write-Host "  RustDesk Version: $Script:RustDeskVersion"
        Write-Host "  Target Platform:  $Script:TargetPlatform"
        Write-Host "  Build Directory:  $Script:BuildDir"
        Write-Host "  Output Directory: $Script:OutputDir"
        Write-Host ""
        
        $confirm = Read-Host "Continue with build? [Y/n]"
        if ($confirm -match "^[Nn]$") {
            Write-Host "Build cancelled."
            exit 0
        }
    }
}

# ============================================================================
# Download RustDesk Sources
# ============================================================================

function Download-RustDesk {
    Write-Header "Downloading RustDesk Server Sources"
    
    $sourceDir = Join-Path $Script:BuildDir "rustdesk-server-$Script:RustDeskVersion"
    
    if (Test-Path $sourceDir) {
        Write-Info "Source directory exists: $sourceDir"
        
        if (-not $Auto) {
            $redownload = Read-Host "Re-download sources? [y/N]"
            if ($redownload -notmatch "^[Yy]$") {
                Write-Success "Using existing sources"
                return $true
            }
        } else {
            Write-Info "Auto mode: Using existing sources"
            return $true
        }
        
        Remove-Item -Path $sourceDir -Recurse -Force
    }
    
    if (-not (Test-Path $Script:BuildDir)) {
        New-Item -ItemType Directory -Path $Script:BuildDir -Force | Out-Null
    }
    
    Push-Location $Script:BuildDir
    
    try {
        Write-Step "Cloning rustdesk-server repository..."
        & git clone --depth 1 --branch $Script:RustDeskVersion $Script:RustDeskRepo "rustdesk-server-$Script:RustDeskVersion" 2>&1
        
        Set-Location "rustdesk-server-$Script:RustDeskVersion"
        
        Write-Step "Initializing submodules..."
        & git submodule update --init --recursive 2>&1
        
        Write-Success "RustDesk sources downloaded successfully"
        return $true
    } catch {
        Write-Error2 "Failed to download sources: $_"
        return $false
    } finally {
        Pop-Location
    }
}

# ============================================================================
# Apply BetterDesk Modifications
# ============================================================================

function Apply-Modifications {
    Write-Header "Applying BetterDesk Modifications"
    
    $sourceDir = Join-Path $Script:BuildDir "rustdesk-server-$Script:RustDeskVersion"
    
    if (-not (Test-Path $sourceDir)) {
        Write-Error2 "Source directory not found: $sourceDir"
        return $false
    }
    
    Push-Location $sourceDir
    
    try {
        # List of files to copy from patches
        $patchFiles = @(
            "main.rs",
            "http_api.rs",
            "database.rs",
            "database_fixed.rs",
            "peer.rs",
            "peer_fixed.rs",
            "rendezvous_server_core.rs"
        )
        
        Write-Step "Copying BetterDesk modifications..."
        
        foreach ($file in $patchFiles) {
            $srcPath = Join-Path $Script:PatchesDir $file
            
            if (Test-Path $srcPath) {
                switch ($file) {
                    "main.rs" {
                        Copy-Item -Path $srcPath -Destination "src\main.rs" -Force
                        Write-Success "Applied: main.rs (HTTP API integration)"
                    }
                    "http_api.rs" {
                        Copy-Item -Path $srcPath -Destination "src\http_api.rs" -Force
                        Write-Success "Applied: http_api.rs (REST API module)"
                    }
                    default {
                        Copy-Item -Path $srcPath -Destination "src\$file" -Force
                        Write-Success "Applied: $file"
                    }
                }
            } else {
                Write-Warning2 "Patch file not found: $file"
            }
        }
        
        # Update Cargo.toml if needed
        Write-Step "Checking Cargo.toml dependencies..."
        
        $cargoPath = "Cargo.toml"
        $cargoContent = Get-Content $cargoPath -Raw
        
        if ($cargoContent -notmatch "axum") {
            Write-Info "Adding HTTP API dependencies to Cargo.toml..."
            
            # This is a simplified approach - may need manual adjustment
            Write-Warning2 "Please verify Cargo.toml has required dependencies (axum, chrono)"
        } else {
            Write-Info "Cargo.toml already has required dependencies"
        }
        
        Write-Success "BetterDesk modifications applied successfully"
        return $true
    } catch {
        Write-Error2 "Failed to apply modifications: $_"
        return $false
    } finally {
        Pop-Location
    }
}

# ============================================================================
# Build Binaries
# ============================================================================

function Build-Binaries {
    Write-Header "Building BetterDesk Binaries"
    
    $sourceDir = Join-Path $Script:BuildDir "rustdesk-server-$Script:RustDeskVersion"
    
    Push-Location $sourceDir
    
    try {
        Write-Step "Building HBBS (Signal Server)..."
        $result = & cargo build --release 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error2 "Build failed!"
            Write-Host $result
            return $false
        }
        
        # Check for binaries
        $hbbsBinary = "target\release\hbbs.exe"
        $hbbrBinary = "target\release\hbbr.exe"
        
        if (-not (Test-Path $hbbsBinary) -or -not (Test-Path $hbbrBinary)) {
            Write-Error2 "Build failed - binaries not found"
            return $false
        }
        
        Write-Success "Build completed successfully!"
        
        # Copy to output directory
        Write-Step "Copying binaries to output directory..."
        
        if (-not (Test-Path $Script:OutputDir)) {
            New-Item -ItemType Directory -Path $Script:OutputDir -Force | Out-Null
        }
        
        $hbbsDst = Join-Path $Script:OutputDir "hbbs-windows-x86_64.exe"
        $hbbrDst = Join-Path $Script:OutputDir "hbbr-windows-x86_64.exe"
        
        Copy-Item -Path $hbbsBinary -Destination $hbbsDst -Force
        Copy-Item -Path $hbbrBinary -Destination $hbbrDst -Force
        
        Write-Success "Binaries saved to:"
        Write-Host "  - $hbbsDst"
        Write-Host "  - $hbbrDst"
        
        return $true
    } catch {
        Write-Error2 "Build error: $_"
        return $false
    } finally {
        Pop-Location
    }
}

# ============================================================================
# Generate Checksums
# ============================================================================

function Generate-Checksums {
    Write-Header "Generating Checksums"
    
    Push-Location $Script:OutputDir
    
    try {
        $checksumFile = "CHECKSUMS.md"
        $dateNow = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        
        $content = @(
            '# BetterDesk Server - Binary Checksums'
            ''
            "Generated: $dateNow"
            "RustDesk Base Version: $Script:RustDeskVersion"
            'BetterDesk Version: 2.0.0'
            ''
            '## SHA256 Checksums'
            ''
            '```'
        ) -join [Environment]::NewLine
        $content += [Environment]::NewLine
        
        $binaries = Get-ChildItem -Filter "hbbs-*" -File
        $binaries += Get-ChildItem -Filter "hbbr-*" -File
        
        foreach ($binary in $binaries) {
            $hash = (Get-FileHash -Path $binary.FullName -Algorithm SHA256).Hash
            $content += "$hash  $($binary.Name)`n"
        }
        
        $content += '```'
        
        $content | Out-File -FilePath $checksumFile -Encoding UTF8
        
        Write-Success ("Checksums saved to: {0}\{1}" -f $Script:OutputDir, $checksumFile)
    } catch {
        Write-Warning2 "Could not generate checksums: $_"
    } finally {
        Pop-Location
    }
}

# ============================================================================
# Clean Build
# ============================================================================

function Clean-Build {
    Write-Header "Cleaning Build Directory"
    
    if (Test-Path $Script:BuildDir) {
        Write-Step "Removing: $Script:BuildDir"
        Remove-Item -Path $Script:BuildDir -Recurse -Force
        Write-Success "Build directory cleaned"
    } else {
        Write-Info "Build directory does not exist"
    }
}

# ============================================================================
# Main
# ============================================================================

function Main {
    # Show help
    if ($Help) {
        Show-HelpMessage
        exit 0
    }
    
    # Clean mode
    if ($Clean) {
        Clean-Build
        exit 0
    }
    
    # Use provided version or default
    if ($Version) {
        $Script:RustDeskVersion = $Version
    }
    
    Write-Host ""
    Write-Host "  ========================================================" -ForegroundColor Cyan
    Write-Host "  BetterDesk Server - Build Script (Windows)              " -ForegroundColor Cyan
    Write-Host "  ========================================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Check dependencies
    if (-not (Check-Dependencies)) {
        exit 1
    }
    
    # Interactive configuration
    Interactive-Config
    
    # Download sources
    if (-not (Download-RustDesk)) {
        exit 1
    }
    
    # Apply modifications
    if (-not (Apply-Modifications)) {
        exit 1
    }
    
    # Build
    if (-not (Build-Binaries)) {
        exit 1
    }
    
    # Generate checksums
    Generate-Checksums
    
    Write-Host ""
    Write-Success "Build process completed successfully!"
    Write-Host ""
    Write-Host "Binaries are available in: $Script:OutputDir" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Test the binaries:"
    Write-Host "     .\hbbs-windows-x86_64.exe --help"
    Write-Host "     .\hbbr-windows-x86_64.exe --help"
    Write-Host ""
    Write-Host "  2. Install using betterdesk.ps1:"
    Write-Host "     .\betterdesk.ps1"
    Write-Host ""
}

# Run
Main
