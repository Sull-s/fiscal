@echo off
rem Agente Fiscal: liga a API fiscal neste computador e religa sozinho se ela parar.
rem Chamado escondido pelo atalho "Agente Fiscal.vbs" da pasta Inicializar do Windows.
setlocal
cd /d "%~dp0"
set "BASE=%LOCALAPPDATA%\FiscalLocal"
set "LOG=%BASE%\agente.log"

:loop
for %%A in ("%LOG%") do if %%~zA GTR 5000000 move /y "%LOG%" "%LOG%.antigo" >nul
echo [%date% %time%] iniciando >> "%LOG%"
"%~dp0node.exe" --env-file="%BASE%\config.env" "%~dp0app\dist\principal.js" >> "%LOG%" 2>&1
echo [%date% %time%] parou (codigo %errorlevel%), religando em 5 segundos >> "%LOG%"
ping -n 6 127.0.0.1 >nul
goto loop
