# ============================================================
# scripts/release.ps1  —  Cria nova versao do Lemon Portal
#
# Uso:
#   .\scripts\release.ps1 patch   # v1.1.0  -> v1.1.1  (bug fix)
#   .\scripts\release.ps1 minor   # v1.1.0  -> v1.2.0  (nova feature)
#   .\scripts\release.ps1 major   # v1.1.0  -> v2.0.0  (breaking change)
#   .\scripts\release.ps1 1.3.0   # versao especifica
# ============================================================

param(
  [Parameter(Mandatory=$true)]
  [string]$Bump
)

Set-Location $PSScriptRoot\..

# ── Ler versao atual do package.json ──────────────────────
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$current = $pkg.version
$parts = $current -split '\.'
$major = [int]$parts[0]
$minor = [int]$parts[1]
$patch = [int]$parts[2]

# ── Calcular nova versao ───────────────────────────────────
switch ($Bump) {
  "patch" { $patch++; $newVer = "$major.$minor.$patch" }
  "minor" { $minor++; $patch = 0; $newVer = "$major.$minor.$patch" }
  "major" { $major++; $minor = 0; $patch = 0; $newVer = "$major.$minor.$patch" }
  default {
    if ($Bump -match '^\d+\.\d+\.\d+$') { $newVer = $Bump }
    else { Write-Error "Use: patch | minor | major | X.Y.Z"; exit 1 }
  }
}

Write-Host "`n🍋 Lemon Portal: $current  →  $newVer`n" -ForegroundColor Yellow

# ── Confirmar ─────────────────────────────────────────────
$confirm = Read-Host "Confirmar release v$newVer? (s/N)"
if ($confirm -notmatch '^[sS]$') { Write-Host "Cancelado."; exit 0 }

# ── Atualizar package.json ─────────────────────────────────
(Get-Content package.json -Raw) -replace `
  '"version": "' + $current + '"', `
  '"version": "' + $newVer  + '"' |
  Set-Content package.json -NoNewline

Write-Host "✓ package.json atualizado"

# ── Build do portal-app.js ─────────────────────────────────
node scripts/gen-portal-app.mjs
Write-Host "✓ portal-app.js gerado"

# ── Bump do SW cache ───────────────────────────────────────
$swContent = Get-Content public/sw.js -Raw
if ($swContent -match "const CACHE = 'lemon-v(\d+)'") {
  $swVer = [int]$Matches[1]
  $swNew = $swVer + 1
  $swContent = $swContent -replace "const CACHE = 'lemon-v$swVer'", "const CACHE = 'lemon-v$swNew'"
  Set-Content public/sw.js $swContent -NoNewline
  Write-Host "✓ SW cache: lemon-v$swVer → lemon-v$swNew"
}

# ── Git: commit, tag e push ────────────────────────────────
git add package.json public/js/portal-app.js public/sw.js
git commit -m "chore: release v$newVer"
git tag -a "v$newVer" -m "Lemon Portal v$newVer"
git push origin main
git push origin "v$newVer"
Write-Host "✓ Push feito (main + tag v$newVer)"

# ── GitHub Release via API ─────────────────────────────────
$token = (git remote get-url origin) -replace '.*:(ghp_[^@]+)@.*','$1'
if (-not $token) {
  Write-Host "⚠ Token GitHub nao encontrado — crie o release manualmente em github.com"
} else {
  $releaseNotes = Read-Host "`nBreve descricao do release (Enter para pular)"
  if (-not $releaseNotes) { $releaseNotes = "Lemon Portal v$newVer" }

  $bodyObj = [ordered]@{
    tag_name         = "v$newVer"
    target_commitish = "main"
    name             = "v$newVer"
    body             = $releaseNotes
    draft            = $false
    prerelease       = $false
  }
  $headers = @{
    "Authorization" = "token $token"
    "Accept"        = "application/vnd.github+json"
  }
  try {
    $r = Invoke-RestMethod `
      -Uri "https://api.github.com/repos/lemontechnologyBR/LemonPortal/releases" `
      -Method POST -Headers $headers `
      -Body ($bodyObj | ConvertTo-Json) `
      -ContentType "application/json; charset=utf-8"
    Write-Host "`n✅ Release publicado: $($r.html_url)" -ForegroundColor Green
  } catch {
    Write-Host "⚠ Erro ao criar release GitHub — verifique manualmente." -ForegroundColor Red
  }
}

Write-Host "`n🚀 v$newVer pronto! Lembre de fazer redeploy no Portainer." -ForegroundColor Green
