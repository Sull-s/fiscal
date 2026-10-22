import type { Agente } from "./index";

/**
 * Ponte entre a tela (renderer) e o emissor embutido no processo principal do Electron, pelo
 * IPC — sem porta de rede: nenhum site nem outro programa alcança o emissor.
 *
 *   // main
 *   ligarAgenteAoIpc(ipcMain, agente);
 *   // preload
 *   contextBridge.exposeInMainWorld("fiscal", { chamar: (p) => ipcRenderer.invoke(CANAL_FISCAL, p) });
 *   // tela (@fiscal/ui)
 *   const fiscal = criarClienteFiscal({ url: "fiscal://local", fetch: fetchPeloIpc(window.fiscal.chamar) });
 *
 * Não importa o Electron: recebe o ipcMain de quem chama.
 */
export const CANAL_FISCAL = "fiscal:fetch";

/** O que atravessa o IPC (só dados simples: o contextBridge não passa Request/Response) */
export interface PedidoIpc {
  url: string;
  metodo: string;
  cabecalhos: [string, string][];
  corpo: string | Uint8Array | null;
}
export interface RespostaIpc {
  status: number;
  cabecalhos: [string, string][];
  corpo: Uint8Array;
}

interface IpcMainMinimo {
  handle(
    canal: string,
    ouvinte: (evento: unknown, pedido: PedidoIpc) => Promise<RespostaIpc>,
  ): void;
  removeHandler(canal: string): void;
}

/** Atende no processo principal os pedidos que a tela manda pelo IPC. Devolve como desligar. */
export function ligarAgenteAoIpc(ipcMain: IpcMainMinimo, agente: Agente, canal = CANAL_FISCAL) {
  ipcMain.handle(canal, async (_evento, pedido) => {
    // Só a API fiscal: nada de URLs de fora pelo processo principal
    const caminho = new URL(pedido.url, "http://agente.local");
    if (!caminho.pathname.startsWith("/v1/") && caminho.pathname !== "/saude") {
      return { status: 404, cabecalhos: [], corpo: new Uint8Array() };
    }
    const metodo = (pedido.metodo || "GET").toUpperCase();
    const r = await agente.fetch(caminho.pathname + caminho.search, {
      method: metodo,
      headers: pedido.cabecalhos.filter(([k]) => k.toLowerCase() !== "authorization"),
      ...(pedido.corpo !== null && metodo !== "GET" && metodo !== "HEAD"
        ? { body: pedido.corpo as BodyInit }
        : {}),
    });
    const cabecalhos: [string, string][] = [];
    r.headers.forEach((valor, nome) => cabecalhos.push([nome, valor]));
    return {
      status: r.status,
      cabecalhos,
      corpo: new Uint8Array(await r.arrayBuffer()),
    };
  });
  return () => ipcMain.removeHandler(canal);
}
