<#
.SYNOPSIS
    Build and flash the deck, quickly.

.DESCRIPTION
    `pio run -t upload` is slow and occasionally hangs for minutes. Two reasons,
    both avoided here:

      * PlatformIO reaches out to the network for update and telemetry checks on
        each invocation. Those are disabled in PlatformIO's settings, and this
        script sets the offline environment variables as a second line of
        defence.
      * `-t upload` rewrites the bootloader, the partition table and boot_app0
        every time. Only the application changes during development, so only the
        application is written.

    A stale esptool holding the port is cleared first. Leaving one running is
    what previously left the app partition half erased and the board stuck in a
    boot loop, so this script never kills one mid-write - it only clears ones
    that outlived their run, and always waits for its own to finish.

.PARAMETER Port
    Serial port. Found automatically when one USB-serial bridge the panel uses
    (CH340, CP210x, FTDI) is attached; pass it when there are several.

.PARAMETER Monitor
    Seconds to capture serial output after flashing. 0 skips it.

.EXAMPLE
    powershell -File tools/flash.ps1
    powershell -File tools/flash.ps1 -Monitor 10
#>

param(
    [string]$Port = "",
    [int]$Monitor = 0,
    [switch]$Full
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 460800, not the board default of 921600: the higher rate corrupts the transfer
# on this CH340. See notes/memory/flashing-the-panel.md.
$baud = 460800

# app0 in partitions_deck.csv. The bootloader at 0x0 and the partition table at
# 0x8000 are only rewritten with -Full.
$appOffset = "0x10000"

$binary = Join-Path $root ".pio\build\esp32-s3-devkitc-1-myboard\firmware.bin"

if (-not $Port) {
    # The COM number changes between machines and between sessions, so the port
    # is found by the USB bridge's vendor ID rather than written down.
    $bridges = Get-CimInstance Win32_PnPEntity |
        Where-Object { $_.DeviceID -match 'VID_(1A86|10C4|0403)' -and $_.Name -match '\((COM\d+)\)' } |
        ForEach-Object { $Matches[1] }
    if (@($bridges).Count -ne 1) {
        throw "found $(@($bridges).Count) USB-serial ports ($($bridges -join ', ')); pass -Port"
    }
    $Port = @($bridges)[0]
}

$env:PLATFORMIO_DISABLE_PROGRESSBAR = "true"
$env:PLATFORMIO_SETTING_ENABLE_TELEMETRY = "No"

$started = Get-Date

Write-Host "building..." -ForegroundColor Cyan
$build = & python -m platformio run 2>&1
if ($LASTEXITCODE -ne 0) {
    $build | Select-Object -Last 25
    throw "build failed"
}
$build | Select-String -Pattern 'RAM:|Flash:' | ForEach-Object { Write-Host "  $_" }

if (-not (Test-Path $binary)) { throw "no firmware.bin at $binary" }
$size = (Get-Item $binary).Length

$stale = Get-Process -Name esptool -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "clearing $($stale.Count) stale esptool process(es)" -ForegroundColor Yellow
    $stale | Stop-Process -Force
    Start-Sleep -Milliseconds 300
}

$images = @($appOffset, $binary)

if ($Full) {
    # Bootloader and partition table too. Needed only when the partition layout
    # changes - and never via `pio run -t upload`, which has hung for minutes at
    # a time on this machine and left the app partition half erased.
    $build = Split-Path -Parent $binary
    $bootApp0 = Join-Path $env:USERPROFILE ".platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"

    foreach ($piece in @(
        @("0x0",    (Join-Path $build "bootloader.bin")),
        @("0x8000", (Join-Path $build "partitions.bin")),
        @("0xe000", $bootApp0)
    )) {
        if (-not (Test-Path $piece[1])) { throw "missing image: $($piece[1])" }
        $images = @($piece[0], $piece[1]) + $images
    }
    Write-Host "full flash: bootloader, partition table and application" -ForegroundColor Yellow
}

Write-Host "flashing $([math]::Round($size/1KB)) KB to $Port at $baud..." -ForegroundColor Cyan
& python -m esptool --chip esp32s3 --port $Port --baud $baud `
    --before default_reset --after hard_reset `
    write_flash -z @images
if ($LASTEXITCODE -ne 0) { throw "flash failed" }

$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Write-Host "done in $elapsed s" -ForegroundColor Green

if ($Monitor -gt 0) {
    Write-Host "--- serial ---" -ForegroundColor Cyan
    $serial = New-Object System.IO.Ports.SerialPort($Port, 460800, 'None', 8, 'One')
    $serial.ReadTimeout = 900
    try {
        $serial.Open()
        $deadline = (Get-Date).AddSeconds($Monitor)
        while ((Get-Date) -lt $deadline) {
            try { Write-Host $serial.ReadLine().TrimEnd() } catch { }
        }
    }
    finally {
        if ($serial.IsOpen) { $serial.Close() }
    }
}
