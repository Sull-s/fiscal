# Agente Fiscal (API no PC do cliente)

A mesma `@fiscal/api` rodando no computador do caixa, para quem tem um cliente só e quer
custo zero. Ela escuta só em `127.0.0.1:9124`, grava tudo no disco e copia para a nuvem.

| | |
|---|---|
| Programa | `%LOCALAPPDATA%\FiscalLocal\programa` (trocado a cada atualização) |
| Dados | `%LOCALAPPDATA%\FiscalLocal\dados` (XMLs, cadastro, numeração em PGlite) |
| Configuração | `%LOCALAPPDATA%\FiscalLocal\config.env` (chave mestra e senha do painel) |
| Log | `%LOCALAPPDATA%\FiscalLocal\agente.log` (gira em 5 MB) |
| Backup | `OneDrive\Notas Fiscais - backup` (XMLs a cada hora, numeração 1×/dia, 14 dias) |

Liga pela pasta Inicializar do Windows (`Agente Fiscal.vbs`, janela escondida), e o `iniciar.cmd`
religa a API 5 s depois se ela cair. Não precisa de administrador.

## Gerar o pacote

```bash
pnpm build
node scripts/empacotar-agente-local.mjs
```

Sai `saida/AgenteFiscal.zip` (~50 MB, com o `node.exe` desta máquina). Não leva segredo nenhum.

## Primeira configuração (no PC do cliente)

1. Extrair o ZIP e rodar `INSTALAR.bat`. Ele mostra a senha do painel e abre `http://127.0.0.1:9124/painel`.
2. No painel: cadastrar a empresa (emitente, série, ambiente **2 = homologação** primeiro),
   enviar o certificado A1 e gerar a chave de API (vai para o sistema do caixa).
3. Migrando de outro emissor: começar a série no número seguinte ao último usado
   (a série precisa estar vazia):

   ```http
   POST /v1/admin/empresas/<id>/numeracao/iniciar
   Authorization: Bearer <senha do painel>
   {"modelo":"65","ambiente":1,"serie":"1","primeiroNumero":221}
   ```

   Conferir: `GET /v1/admin/empresas/<id>/numeracao?modelo=65&ambiente=1&serie=1`.
4. Testar 3 vendas em homologação, depois mudar para produção.

O sistema web (ex.: RestôFlow em `*.base44.app`) chama `http://127.0.0.1:9124/v1/...` direto do
navegador com a chave de API. Na primeira chamada o Chrome pede licença para acessar a rede
local: clicar em **Permitir**.

## Restaurar (PC novo ou HD perdido)

1. Instalar o agente no PC novo.
2. Parar o agente (`DESINSTALAR.bat`), copiar `Notas Fiscais - backup\arquivos` para
   `%LOCALAPPDATA%\FiscalLocal\dados\arquivos`.
3. Numeração: apagar `dados\numeracao` e carregar a cópia mais nova:

   ```js
   // na pasta programa\app, com ..\node.exe
   import { readFileSync } from "node:fs";
   import { PGlite } from "@electric-sql/pglite";
   const db = new PGlite("C:/.../FiscalLocal/dados/numeracao", {
     loadDataDir: new Blob([readFileSync("numeracao-AAAA-MM-DD.tar.gz")]),
   });
   await db.close();
   ```

   Notas emitidas depois da cópia: conferir na SEFAZ e ajustar (o cadastro e os XMLs vêm
   da cópia de hora em hora).
4. A configuração não vai no backup (tem a chave mestra). Num PC novo é criada outra: envie o
   certificado de novo pelo painel.
5. `INSTALAR.bat` de novo.

## Limites

- Só funciona com o PC ligado e com alguém logado no Windows (é quando o caixa vende).
- Um PC por empresa: dois caixas emitindo precisam da API central (VPS).
- Atualizar = levar o ZIP novo e rodar `INSTALAR.bat` (dados e configuração ficam).
