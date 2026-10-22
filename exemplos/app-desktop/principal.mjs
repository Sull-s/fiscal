// Processo principal do app (Electron). O emissor fiscal roda AQUI DENTRO: sem servidor, sem
// porta de rede e sem o cliente instalar o agente separado. A tela fala com ele pelo IPC.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chaveMestraProtegida, iniciarAgente } from "@fiscal/agente";
import { ligarAgenteAoIpc } from "@fiscal/agente/electron";
import { BrowserWindow, app, ipcMain, safeStorage } from "electron";

const aqui = fileURLToPath(new URL(".", import.meta.url));
let agente;

app.whenReady().then(async () => {
  // Dados fiscais na pasta do app deste usuário (XMLs por 5 anos, numeração, cadastro)
  const pastaFiscal = join(app.getPath("userData"), "fiscal");

  agente = await iniciarAgente({
    pastaDados: join(pastaFiscal, "dados"),
    // A chave que tranca o certificado e a senha fica protegida pelo Windows (DPAPI):
    // só este usuário, neste PC, consegue abrir
    chaveMestra: () =>
      chaveMestraProtegida({
        arquivo: join(pastaFiscal, "chave.bin"),
        proteger: (texto) => safeStorage.encryptStringAsync(texto),
        abrir: (dados) => safeStorage.decryptStringAsync(dados),
      }),
    // Cópia de hora em hora das notas no OneDrive do cliente (se tiver)
    ...(process.env.OneDrive
      ? { pastaBackup: join(process.env.OneDrive, "Notas Fiscais - backup") }
      : {}),
  });
  ligarAgenteAoIpc(ipcMain, agente);

  const janela = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Caixa (exemplo)",
    webPreferences: {
      preload: join(aqui, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Conferência automática desenha fora da tela (dá para fotografar sem monitor)
      ...(process.env.FISCAL_CONFERIR ? { offscreen: true } : {}),
    },
  });
  await janela.loadFile(join(aqui, "tela", "index.html"));

  // Conferência automática (usada pelo repositório para provar que o exemplo funciona):
  // FISCAL_CONFERIR=caminho.png abre a tela, tira uma foto e fecha
  if (process.env.FISCAL_CONFERIR) {
    await new Promise((ok) => setTimeout(ok, 2500));
    try {
      const texto = await janela.webContents.executeJavaScript("document.body.innerText");
      console.log(`TELA: ${texto.replace(/\s+/g, " ").slice(0, 400)}`);
      const foto = await janela.webContents.capturePage();
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.FISCAL_CONFERIR, foto.toPNG());
    } catch (erro) {
      console.log(`CONFERÊNCIA FALHOU: ${erro.message}`);
    }
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
// Fecha o banco da numeração antes de sair (evita reservar número sem registrar)
app.on("will-quit", (evento) => {
  if (!agente) return;
  evento.preventDefault();
  const parar = agente.parar();
  agente = undefined;
  parar.finally(() => app.exit(0));
});
