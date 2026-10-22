# Exemplo: caixa em Electron com o emissor fiscal embutido

Um app instalado no PC que emite NFC-e (e NF-e) **sem servidor e sem o cliente instalar o agente
separado**: o emissor (`@fiscal/agente`) roda dentro do processo principal do Electron, e a tela
(`@fiscal/ui`) fala com ele pelo IPC. É o modelo para qualquer app novo.

```
tela (React + @fiscal/ui)
   │  window.fiscal.chamar(...)      ← preload.cjs (só isso é exposto)
   ▼
processo principal (principal.mjs)
   │  ligarAgenteAoIpc(ipcMain, agente)
   ▼
@fiscal/agente  →  numeração, XMLs, contingência offline, rotinas, backup
   │  certificado A1 aberto só aqui (cifrado com a chave protegida pelo Windows)
   ▼
SEFAZ / gov.br
```

## Rodar

```bash
pnpm install
pnpm build
pnpm --filter exemplo-app-desktop iniciar
```

Na primeira vez abre **Configurar nota fiscal**: CNPJ, IE, endereço (o CEP preenche o resto),
regime, ambiente (**Teste** primeiro), certificado A1 e senha. Depois, **Testar com a SEFAZ** e
pronto: a aba **Caixa** já emite.

## Os 4 arquivos

| Arquivo | O que faz |
|---|---|
| `principal.mjs` | Liga o emissor (`iniciarAgente`), guarda a chave com `safeStorage` (DPAPI), abre a janela e liga o IPC |
| `preload.cjs` | Expõe só `window.fiscal.chamar` para a tela (nada de Node, arquivos ou certificado) |
| `tela/app.tsx` | A tela: `ConfigurarEmissor`, `EmissorNfce`, `ListaNotas`, `RelatorioContador` |
| `tela/index.html` | CSP fechada: a tela só fala com o próprio código e com o ViaCEP |

## Onde ficam os dados (no PC do cliente)

| | |
|---|---|
| Notas, numeração e cadastro | `%APPDATA%\exemplo-app-desktop\fiscal\dados` (guarde 5 anos) |
| Chave que tranca o certificado | `%APPDATA%\exemplo-app-desktop\fiscal\chave.bin` (cifrada pelo Windows) |
| Backup automático | `OneDrive\Notas Fiscais - backup` (se o OneDrive estiver no PC) |

O certificado e a senha **nunca** ficam no código, no repositório nem em arquivo aberto: o cliente
coloca na tela, e o emissor guarda cifrado.

## Gerar o instalador

```bash
pnpm --filter exemplo-app-desktop instalador
```

Sai `saida/Caixa Exemplo Setup 0.1.0.exe` (~130 MB: quase tudo é o próprio Electron). Testado
em 22/10/2026: o app empacotado abre, cria a chave protegida pelo Windows e sobe a numeração.
A configuração do [electron-builder](https://www.electron.build/) está no `package.json`
(campo `build`). O que importa para a parte fiscal:

- `asarUnpack` para `**/@electric-sql/pglite/**` e `**/pdfkit/**` (arquivos que eles leem do disco);
- `signAndEditExecutable: false`: sem certificado de assinatura de código, o electron-builder
  tentaria baixar ferramentas que exigem o Modo de Desenvolvedor do Windows. Para distribuir a
  clientes, compre um certificado de assinatura (evita o aviso "editor desconhecido") e tire essa
  linha;
- os dados ficam em `userData`, que a desinstalação **não** apaga (as notas ficam).

## Conferência automática

`FISCAL_CONFERIR=foto.png electron .` abre a tela fora da vista, escreve o texto dela no console,
salva uma foto e fecha. Serve para provar que o app sobe depois de uma mudança.
