$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$accessTokenFile = Join-Path $root "kanban-access-token.txt"
$githubTokenFile = Join-Path $root "github-token.txt"

if (-not (Test-Path -LiteralPath $accessTokenFile)) {
  throw "Missing kanban-access-token.txt"
}

$env:KANBAN_ACCESS_TOKEN = (Get-Content -Raw -LiteralPath $accessTokenFile).Trim()
$env:GITHUB_DEFAULT_REPO = "Creaboobot/Board"

if (Test-Path -LiteralPath $githubTokenFile) {
  $env:GITHUB_TOKEN = (Get-Content -Raw -LiteralPath $githubTokenFile).Trim()
} else {
  Remove-Item Env:\GITHUB_TOKEN -ErrorAction SilentlyContinue
}

node (Join-Path $root "server.mjs")
