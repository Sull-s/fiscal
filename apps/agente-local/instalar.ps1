# Instala ou atualiza o Agente Fiscal neste computador (sem precisar de administrador).
# Os dados (notas, numeração, cadastro) e a configuração nunca são apagados por uma atualização.
# Obs.: sem $ErrorActionPreference = "Stop" de propósito: no Windows PowerShell 5.1 qualquer linha
# de um .exe no stderr vira erro fatal.

$porta = 9124
$base = Join-Path $env:LOCALAPPDATA "FiscalLocal"
$programa = Join-Path $base "programa"
$config = Join-Path $base "config.env"
$origem = $PSScriptRoot

function Passo($texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }

Write-Host "Agente Fiscal - instalação" -ForegroundColor Green

Passo "Parando a versão anterior (se houver)"
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*\FiscalLocal\programa\*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Passo "Copiando o programa para $programa"
New-Item -ItemType Directory -Force -Path $base | Out-Null
if (Test-Path $programa) { Remove-Item -Recurse -Force $programa }
Copy-Item -Recurse -Path (Join-Path $origem "programa") -Destination $programa
if (-not (Test-Path (Join-Path $programa "node.exe"))) {
  Write-Host "Falha ao copiar o programa. Extraia o ZIP inteiro antes de instalar." -ForegroundColor Red
  Read-Host "Enter para sair"; exit 1
}

if (Test-Path $config) {
  Passo "Configuração existente mantida ($config)"
} else {
  Passo "Criando a configuração"
  $gerador = [Security.Cryptography.RandomNumberGenerator]::Create()
  $b = New-Object byte[] 32; $gerador.GetBytes($b); $chave = [Convert]::ToBase64String($b)
  $t = New-Object byte[] 24; $gerador.GetBytes($t); $token = [Convert]::ToBase64String($t) -replace '[+/=]', ''
  if ($env:OneDrive -and (Test-Path $env:OneDrive)) {
    $backup = Join-Path $env:OneDrive "Notas Fiscais - backup"
  } else {
    $backup = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Notas Fiscais - backup"
    Write-Host "OneDrive não encontrado: o backup vai para $backup (ponha esta pasta no Google Drive ou OneDrive)." -ForegroundColor Yellow
  }
  # Valores SEM aspas: entre aspas o Node troca \n por quebra de linha e estraga caminhos do Windows
  $linhas = @(
    "# Agente Fiscal - configuração. Não compartilhe este arquivo.",
    "FISCAL_CHAVE_MESTRA=$chave",
    "FISCAL_TOKEN_ADMIN=$token",
    "FISCAL_PASTA_DADOS=$(Join-Path $base 'dados')",
    "FISCAL_PASTA_BACKUP=$backup",
    "FISCAL_CORS_ORIGENS=https://*.base44.app,https://*.base44.com",
    "HOST=127.0.0.1",
    "PORTA=$porta",
    "# Alertas no celular (Discord/Slack): tire o # e cole o endereço do webhook",
    "# FISCAL_ALERTA_URL="
  )
  [IO.File]::WriteAllLines($config, $linhas, (New-Object Text.UTF8Encoding $false))
}

Passo "Ligando junto com o Windows"
$inicializar = [Environment]::GetFolderPath("Startup")
$atalho = Join-Path $inicializar "Agente Fiscal.vbs"
$iniciar = Join-Path $programa "iniciar.cmd"
Set-Content -Path $atalho -Encoding Unicode -Value ('CreateObject("WScript.Shell").Run """' + $iniciar + '""", 0, False')

Passo "Impedindo o computador de dormir quando estiver na tomada"
cmd /c "powercfg /change standby-timeout-ac 0 >nul 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Host "Não deu para mudar a energia. Ajuste em Configurações > Sistema > Energia: Suspender = Nunca." -ForegroundColor Yellow }

Passo "Acertando o relógio"
cmd /c "w32tm /resync >nul 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Host "Confira em Configurações > Hora e idioma > Data e hora: 'Definir horário automaticamente' ligado e clique em 'Sincronizar agora'." -ForegroundColor Yellow }

Passo "Ligando o agente"
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$atalho`""
$ok = $false
for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
  Start-Sleep -Seconds 1
  try { $s = Invoke-RestMethod -Uri "http://127.0.0.1:$porta/saude" -TimeoutSec 2; $ok = $s.ok } catch {}
}
if (-not $ok) {
  Write-Host "O agente não respondeu. Veja o arquivo $base\agente.log" -ForegroundColor Red
  Read-Host "Enter para sair"; exit 1
}

$tokenAtual = ((Get-Content $config | Where-Object { $_ -like "FISCAL_TOKEN_ADMIN=*" }) -replace '^FISCAL_TOKEN_ADMIN=', '')
Write-Host ""
Write-Host "Pronto! O Agente Fiscal está funcionando." -ForegroundColor Green
Write-Host "  Painel:  http://127.0.0.1:$porta/painel"
Write-Host "  Senha do painel (token): $tokenAtual"
Write-Host "  Dados:   $base\dados"
Write-Host "  Backup:  $((Get-Content $config | Where-Object { $_ -like 'FISCAL_PASTA_BACKUP=*' }) -replace '^FISCAL_PASTA_BACKUP=', '')"
Write-Host ""
Write-Host "O painel vai abrir no navegador. Cole a senha acima para entrar."
Start-Process "http://127.0.0.1:$porta/painel"
Read-Host "Enter para fechar"
