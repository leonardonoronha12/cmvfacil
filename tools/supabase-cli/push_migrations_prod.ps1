param(
  [string]$ProjectRef = "erbxmgvrdxqfvrejbsrt",
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [string]$DbPassword = $env:SUPABASE_DB_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here "..\\..")
$cli = Join-Path $here "supabase.exe"
if (-not (Test-Path $cli)) { throw "supabase.exe not found at $cli" }

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
    if ($v.StartsWith("\"") -and $v.EndsWith("\"") -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    if ($v.StartsWith("'") -and $v.EndsWith("'") -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    $v = $v -replace "\\r\\n", ""
    $v = $v -replace "\\n", ""
    return $v
  }
  return $null
}

if (-not $AccessToken) { $AccessToken = Read-DotenvValue -Path (Join-Path $repoRoot ".env.local") -Key "SUPABASE_ACCESS_TOKEN" }
if (-not $DbPassword) { $DbPassword = Read-DotenvValue -Path (Join-Path $repoRoot ".env.local") -Key "SUPABASE_DB_PASSWORD" }

if (-not $AccessToken) { throw "Missing SUPABASE_ACCESS_TOKEN" }
if (-not $DbPassword) { throw "Missing SUPABASE_DB_PASSWORD" }

Push-Location $repoRoot
try {
  $env:SUPABASE_ACCESS_TOKEN = $AccessToken
  & $cli link --project-ref $ProjectRef --password $DbPassword
  & $cli db push --yes
} finally {
  Pop-Location
}
