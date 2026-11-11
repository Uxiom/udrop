param(
  [switch]$CreatePortableZip
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$DistDir = Join-Path $RootDir "dist"
$PublicDir = Join-Path $RootDir "src\public"
$Csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $Csc)) {
  throw "C# compiler not found at $Csc"
}

if (-not (Test-Path $DistDir)) {
  New-Item -ItemType Directory -Path $DistDir | Out-Null
}

Write-Host "[1/5] Generating src/embedded-assets.js..."
$embedScript = @'
const fs = require('fs');
const path = require('path');
const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'src', 'public');
const filesToEmbed = [
  'index.html',
  'style.css',
  'app.js',
  'qr-kinetic.js',
  'qr.html',
  'island.html',
  'manifest.json',
  'assets/icon-brand.svg'
];
const assets = {};
for (const rel of filesToEmbed) {
  const full = path.join(publicDir, rel);
  if (fs.existsSync(full)) {
    assets[rel] = fs.readFileSync(full, 'utf-8');
  }
}
fs.writeFileSync(
  path.join(rootDir, 'src', 'embedded-assets.js'),
  'export const EMBEDDED_ASSETS = ' + JSON.stringify(assets, null, 2) + ';\n',
  'utf-8'
);
'@
Push-Location $RootDir
try {
  node -e $embedScript

  Write-Host "[2/5] Bundling dist/bundle.cjs via esbuild..."
  npx --yes esbuild bin/index.js --bundle --platform=node --format=cjs --outfile=dist/bundle.cjs

  $distNode = Join-Path $DistDir "node.exe"
  if (-not (Test-Path $distNode)) {
    $sysNode = (Get-Command node).Source
    Write-Host "Copying system node runtime ($sysNode) to dist/node.exe..."
    Copy-Item $sysNode $distNode -Force
  }

  Write-Host "[3/5] Compiling dist/udrop.exe (System Tray + Glass QR Overlay)..."
  & $Csc /nologo /target:winexe /optimize+ `
    /win32manifest:installer\app.manifest `
    /out:dist\udrop.exe `
    /r:System.dll `
    /r:System.Drawing.dll `
    /r:System.Windows.Forms.dll `
    /r:System.Web.Extensions.dll `
    installer\AssemblyInfo.cs `
    installer\Launcher.cs `
    installer\TrayFlyoutForm.cs `
    installer\GlassQrOverlayForm.cs

  Write-Host "[4/5] Creating embedded uDropPayload.zip..."
  $tempPayloadDir = Join-Path $env:TEMP ("udrop-payload-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tempPayloadDir | Out-Null
  $payloadZip = Join-Path $env:TEMP ("uDropPayload-" + [guid]::NewGuid().ToString("N") + ".zip")

  try {
    Copy-Item (Join-Path $DistDir "node.exe") $tempPayloadDir -Force
    Copy-Item (Join-Path $DistDir "bundle.cjs") $tempPayloadDir -Force
    Copy-Item (Join-Path $DistDir "udrop.exe") $tempPayloadDir -Force
    Copy-Item (Join-Path $PSScriptRoot "uninstall.bat") $tempPayloadDir -Force
    Copy-Item (Join-Path $PSScriptRoot "uninstall.bat") (Join-Path $DistDir "uninstall.bat") -Force

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $tempPayloadDir,
      $payloadZip,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false
    )

    Write-Host "[5/5] Compiling standalone dist/udrop-setup.exe..."
    & $Csc /nologo /target:winexe /optimize+ `
      /win32manifest:installer\app.manifest `
      /out:dist\udrop-setup.exe `
      /resource:"$payloadZip,uDropPayload.zip" `
      /r:System.dll `
      /r:System.Drawing.dll `
      /r:System.Windows.Forms.dll `
      /r:System.IO.Compression.dll `
      /r:System.IO.Compression.FileSystem.dll `
      installer\AssemblyInfo.cs `
      installer\Installer.cs

    if ($CreatePortableZip) {
      $portableZip = Join-Path $DistDir "uDrop-Portable-win64.zip"
      if (Test-Path $portableZip) { Remove-Item $portableZip -Force }
      Copy-Item $payloadZip $portableZip -Force
      Write-Host "Created portable archive: $portableZip"
    }
  } finally {
    if (Test-Path $tempPayloadDir) { Remove-Item $tempPayloadDir -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $payloadZip) { Remove-Item $payloadZip -Force -ErrorAction SilentlyContinue }
  }

  $setupInfo = Get-Item (Join-Path $DistDir "udrop-setup.exe")
  Write-Host ("Build complete: udrop-setup.exe ({0:N2} MB)" -f ($setupInfo.Length / 1MB))
} finally {
  Pop-Location
}
