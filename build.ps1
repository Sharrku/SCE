# Baut module.zip + module.json fuer ein GitHub-Release.
# Aufruf:  .\build.ps1 -GitHubUser DEINNAME [-Repo sce]
param(
  [Parameter(Mandatory)] [string] $GitHubUser,
  [string] $Repo = "SCE"
)
$ErrorActionPreference = "Stop"
$src  = Join-Path $env:LOCALAPPDATA "FoundryVTT\Data\modules\sce"
$out  = $PSScriptRoot
$man  = Get-Content (Join-Path $src "module.json") -Raw | ConvertFrom-Json
$ver  = $man.version
$base = "https://github.com/$GitHubUser/$Repo"

$man | Add-Member -Force url      $base
$man | Add-Member -Force manifest "$base/releases/latest/download/module.json"
$man | Add-Member -Force download "$base/releases/download/v$ver/module.zip"
$json = $man | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText((Join-Path $out "module.json"), $json, (New-Object Text.UTF8Encoding $false))

# ZIP mit Vorwaertsschraegstrichen (Linux-Server!), module.json im Root
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zipPath = Join-Path $out "module.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
$zip = [IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
  foreach ($f in Get-ChildItem $src -Recurse -File) {
    $rel = $f.FullName.Substring($src.Length + 1).Replace("\", "/")
    if ($rel -eq "module.json") { continue }
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, "Optimal")
  }
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $out "module.json"), "module.json", "Optimal")
} finally { $zip.Dispose() }

# Modulquellen fuer das Repo spiegeln (ohne zip)
foreach ($d in "scripts","styles","templates","lang","sounds","examples") {
  $t = Join-Path $out $d
  if (Test-Path $t) { Remove-Item $t -Recurse -Force }
  Copy-Item (Join-Path $src $d) $t -Recurse
}
"Fertig: v$ver"
"  Manifest:  $($man.manifest)"
"  Download:  $($man.download)"
"  Dateien:   $zipPath"
