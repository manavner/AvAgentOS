<#
.SYNOPSIS
  Expose AvAgentOS Dashboard from WSL to the local home LAN via Windows portproxy.

.DESCRIPTION
  Run this script in Windows PowerShell as Administrator.
  It detects the current WSL IPv4 address for the selected distro and maps:

      Windows LAN IP:3131  ->  WSL_IP:3131

  It also creates/updates a Windows Firewall inbound rule for TCP 3131 on Private networks.

  SECURITY:
  - This exposes only the AvAgentOS Dashboard port 3131.
  - It does NOT expose Hermes Bridge port 8765.
  - Do NOT enable router port-forwarding to the internet.
  - AvAgentOS currently has no full authentication; use only on trusted private LAN.

.EXAMPLE
  PowerShell as Administrator:

    Set-ExecutionPolicy -Scope Process Bypass -Force
    .\expose-avagentos-lan.ps1

.EXAMPLE
  Specify a distro name:

    .\expose-avagentos-lan.ps1 -Distro Ubuntu

.EXAMPLE
  Dry-run only:

    .\expose-avagentos-lan.ps1 -DryRun
#>

param(
  [int]$DashboardPort = 3131,
  [string]$ListenAddress = "0.0.0.0",
  [string]$Distro = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok($Message) {
  Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Require-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from Windows PowerShell as Administrator."
  }
}

function Invoke-WSLCommand($Command) {
  if ([string]::IsNullOrWhiteSpace($Distro)) {
    return (& wsl.exe sh -lc $Command) -join "`n"
  }
  return (& wsl.exe -d $Distro sh -lc $Command) -join "`n"
}

function Get-WSLIPv4 {
  $cmd = "ip -4 addr show eth0 | awk '/inet / {print `$2}' | cut -d/ -f1 | head -n1"
  $ip = (Invoke-WSLCommand $cmd).Trim()
  if (-not $ip) {
    throw "Could not detect WSL eth0 IPv4 address. Is WSL running?"
  }
  if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "Detected WSL IP does not look like IPv4: '$ip'"
  }
  return $ip
}

function Get-WindowsLanIPs {
  $ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.PrefixOrigin -ne 'WellKnown' -and
      $_.InterfaceOperationalStatus -eq 'Up'
    } |
    Select-Object -ExpandProperty IPAddress
  return $ips
}

function Run-Cmd($Description, $ScriptBlock) {
  Write-Step $Description
  if ($DryRun) {
    Write-Warn "DryRun: skipped"
    return
  }
  & $ScriptBlock
}

Require-Admin

Write-Step "Detecting current WSL IP"
$wslIp = Get-WSLIPv4
Write-Ok "WSL IP: $wslIp"

Write-Step "Checking AvAgentOS port from Windows host"
$portOpen = Test-NetConnection -ComputerName $wslIp -Port $DashboardPort -InformationLevel Quiet -WarningAction SilentlyContinue
if ($portOpen) {
  Write-Ok "WSL $wslIp:$DashboardPort is reachable from Windows"
} else {
  Write-Warn "WSL $wslIp:$DashboardPort is not reachable from Windows. Make sure AvAgentOS is running in WSL: npm start"
}

Run-Cmd "Removing old portproxy for $ListenAddress:$DashboardPort if it exists" {
  & netsh interface portproxy delete v4tov4 listenaddress=$ListenAddress listenport=$DashboardPort | Out-Null
}

Run-Cmd "Adding portproxy $ListenAddress:$DashboardPort -> $wslIp:$DashboardPort" {
  & netsh interface portproxy add v4tov4 listenaddress=$ListenAddress listenport=$DashboardPort connectaddress=$wslIp connectport=$DashboardPort | Out-Null
}

$ruleName = "AvAgentOS Dashboard $DashboardPort"
Run-Cmd "Creating/updating Windows Firewall rule: $ruleName" {
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    Remove-NetFirewallRule -DisplayName $ruleName
  }
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $DashboardPort `
    -Profile Private | Out-Null
}

Write-Step "Current portproxy table"
& netsh interface portproxy show all

Write-Step "Windows LAN IP candidates"
$lanIps = @(Get-WindowsLanIPs)
if ($lanIps.Count -eq 0) {
  Write-Warn "No LAN IPv4 address detected. Check ipconfig manually."
} else {
  foreach ($ip in $lanIps) {
    Write-Host "  http://$ip`:$DashboardPort" -ForegroundColor White
  }
}

Write-Step "Done"
Write-Host "Open AvAgentOS from another computer on the same home LAN using one of the URLs above." -ForegroundColor Green
Write-Host "Do NOT expose this port to the internet/router port-forwarding until auth/security is added." -ForegroundColor Yellow
