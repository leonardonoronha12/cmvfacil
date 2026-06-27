param(
  [string]$ProjectRef = "erbxmgvrdxqfvrejbsrt",
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [string]$DbPassword = $env:SUPABASE_DB_PASSWORD,
  [string]$SiteUrl = $env:BUBBLE_OBJ_SITE_URL
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\\..")

function Read-DotenvValue {
  param(
    [string]$Path,
    [string]$Key
  )
  if (-not (Test-Path $Path)) { return $null }
  $lines = Get-Content -LiteralPath $Path -ErrorAction Stop
  foreach ($line in $lines) {
    $t = $line.Trim()
    if (-not $t) { continue }
    if ($t.StartsWith("#")) { continue }
    if (-not $t.StartsWith("$Key=")) { continue }
    $v = $t.Substring($Key.Length + 1).Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"') -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    if ($v.StartsWith("'") -and $v.EndsWith("'") -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    $v = $v -replace "\\r\\n", ""
    $v = $v -replace "\\n", ""
    return $v
  }
  return $null
}

$cliEnv = Join-Path $repoRoot ".env.supabase-cli.local"
if (-not $AccessToken) { $AccessToken = Read-DotenvValue -Path $cliEnv -Key "SUPABASE_ACCESS_TOKEN" }
if (-not $DbPassword) { $DbPassword = Read-DotenvValue -Path $cliEnv -Key "SUPABASE_DB_PASSWORD" }

if (-not $AccessToken) { throw "Missing SUPABASE_ACCESS_TOKEN (preencha .env.supabase-cli.local)" }
if (-not $DbPassword) { throw "Missing SUPABASE_DB_PASSWORD (preencha .env.supabase-cli.local)" }

Push-Location $repoRoot
try {
  $env:SUPABASE_ACCESS_TOKEN = $AccessToken
  $env:SUPABASE_DB_PASSWORD = $DbPassword
  if ($SiteUrl) { $env:BUBBLE_OBJ_SITE_URL = $SiteUrl } else { $env:BUBBLE_OBJ_SITE_URL = "http://localhost:3000" }

  powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\supabase-cli\\push_migrations_prod.ps1 -ProjectRef $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw "push_migrations_prod.ps1 failed (exit $LASTEXITCODE)" }
  node .\\tools\\bubble-obj\\run_staging_prod.mjs
  if ($LASTEXITCODE -ne 0) { throw "run_staging_prod.mjs failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
