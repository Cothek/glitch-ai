<#
.SYNOPSIS
    Saves clipboard image to the screenshots/ directory for @vision analysis.
.DESCRIPTION
    Reads an image from the Windows clipboard and saves it to screenshots/
    as a PNG file. Updates screenshots/manifest.json so Glitch can find it.
    If no image is on the clipboard, exits with an error.
.PARAMETER OutDir
    Output directory (default: ../screenshots relative to script location)
.EXAMPLE
    # 1. Copy an image to clipboard (Ctrl+C or Snipping Tool)
    # 2. Run:
    .\scripts\save-clipboard-image.ps1
    # 3. Saved to: screenshots/clipboard-{timestamp}.png
#>

param(
    [string]$OutDir = ""
)

# Resolve output directory
if (-not $OutDir) {
    $OutDir = Join-Path -Path $PSScriptRoot -ChildPath "..\screenshots"
}
$OutDir = (Resolve-Path -Path $OutDir -ErrorAction SilentlyContinue) ?? (New-Item -ItemType Directory -Path $OutDir -Force).FullName

# Ensure screenshots directory exists
if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

# Load required assembly
Add-Type -AssemblyName System.Windows.Forms

# Try to get image from clipboard
$clipboardImage = [System.Windows.Forms.Clipboard]::GetImage()

if (-not $clipboardImage) {
    Write-Error "❌ No image found on clipboard. Copy an image first (Ctrl+C or Snipping Tool)."
    exit 1
}

# Generate filename
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$filename = "clipboard-$timestamp.png"
$filepath = Join-Path -Path $OutDir -ChildPath $filename

# Save as PNG
$clipboardImage.Save($filepath, [System.Drawing.Imaging.ImageFormat]::Png)

# Get file info
$fileInfo = Get-Item -LiteralPath $filepath

# Update manifest
$manifest = @{
    latest = @{
        relative = "screenshots/$filename"
        absolute = $filepath
        timestamp = $timestamp
        iso = (Get-Date -Format "o")
        mime = "image/png"
        filename = $filename
        size_bytes = $fileInfo.Length
        size_kb = [math]::Round($fileInfo.Length / 1024, 1)
        source = "clipboard"
    }
} | ConvertTo-Json

$manifest | Out-File -FilePath (Join-Path -Path $OutDir -ChildPath "manifest.json") -Encoding utf8

Write-Host "✅ Clipboard image saved:" -ForegroundColor Green
Write-Host "   $filepath" -ForegroundColor Cyan
Write-Host "   Size: $([math]::Round($fileInfo.Length / 1024, 1)) KB" -ForegroundColor Gray
Write-Host ""
Write-Host "Tell Glitch: 'Analyze the image in screenshots/$filename'" -ForegroundColor Yellow
