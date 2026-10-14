# Desliga o Agente Fiscal e tira do início do Windows.
# NÃO apaga as notas, a numeração nem a configuração (a lei manda guardar as notas por 5 anos).

$base = Join-Path $env:LOCALAPPDATA "FiscalLocal"
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*\FiscalLocal\programa\*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath("Startup")) "Agente Fiscal.vbs")
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $base "programa")
Write-Host "Agente Fiscal desligado e removido do início do Windows." -ForegroundColor Green
Write-Host "As notas e a configuração continuam em $base (não apague: a lei exige guardar por 5 anos)."
Read-Host "Enter para fechar"
