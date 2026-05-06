# Deploy Atenna Guard Extension Backend para Hetzner VPS
# Uso: .\deploy-vps.ps1

param(
    [string]$VpsIp = "157.90.246.156",
    [string]$VpsUser = "raiz",
    [string]$VpsPassword = "4dkcmxntwiwFsxNipCpd",
    [string]$LocalBackendPath = "c:\projetos\atenna-guard-extension\backend"
)

Write-Host "🚀 Iniciando deploy da Atenna Guard para VPS..." -ForegroundColor Green

# 1. Verificar se sshpass está instalado (para autenticação via senha)
$sshpassPath = Get-Command sshpass -ErrorAction SilentlyContinue
if (-not $sshpassPath) {
    Write-Host "⚠️  sshpass não encontrado. Use choco install sshpass ou configure SSH key" -ForegroundColor Yellow
    Write-Host "   Alternativa: Use PuTTY ou WinSCP para fazer SCP manual" -ForegroundColor Yellow
    exit 1
}

# 2. Sincronizar backend files via SCP
Write-Host "`n📦 Sincronizando arquivos do backend..." -ForegroundColor Cyan
$scpCmd = "sshpass -p '$VpsPassword' scp -r -o StrictHostKeyChecking=no '$LocalBackendPath\*' ${VpsUser}@${VpsIp}:/root/atenna-backend/"
Invoke-Expression $scpCmd

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Arquivos sincronizados com sucesso" -ForegroundColor Green
} else {
    Write-Host "❌ Erro ao sincronizar arquivos" -ForegroundColor Red
    exit 1
}

# 3. SSH para a VPS e reiniciar os containers
Write-Host "`n🐳 Reiniciando Docker containers..." -ForegroundColor Cyan

$sshCmd = @"
cd /root/atenna && \
docker-compose down && \
docker-compose up -d && \
sleep 3 && \
docker-compose logs backend | head -20
"@

sshpass -p "$VpsPassword" ssh -o StrictHostKeyChecking=no "${VpsUser}@${VpsIp}" $sshCmd

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Containers reiniciados com sucesso" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Possível erro ao reiniciar. Verifique manualmente." -ForegroundColor Yellow
}

# 4. Verificar se backend está respondendo
Write-Host "`n🔍 Testando endpoint /health..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

$healthUrl = "https://atennaplugin.maestro-n8n.site/health"
try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -ErrorAction Stop
    $health = $response.Content | ConvertFrom-Json
    Write-Host "✅ Backend respondendo: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "❌ Backend ainda não respondendo. Aguarde mais tempo e tente novamente." -ForegroundColor Red
    Write-Host "   Dica: ssh ${VpsUser}@${VpsIp} 'docker-compose logs -f backend'" -ForegroundColor Yellow
    exit 1
}

# 5. Testar endpoint de callback
Write-Host "`n🔍 Testando endpoint /auth/callback..." -ForegroundColor Cyan
$callbackUrl = "https://atennaplugin.maestro-n8n.site/auth/callback?access_token=test123"
try {
    $response = Invoke-WebRequest -Uri $callbackUrl -UseBasicParsing -ErrorAction Stop
    Write-Host "✅ Callback endpoint respondendo" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Callback endpoint: $($_.Exception.Response.StatusCode)" -ForegroundColor Yellow
}

Write-Host "`n✨ Deploy concluído!" -ForegroundColor Green
Write-Host "   Backend: https://atennaplugin.maestro-n8n.site" -ForegroundColor Cyan
Write-Host "   Agora teste a extensão no navegador!" -ForegroundColor Cyan
