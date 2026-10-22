/**
 * `fetch` que fala com o emissor embutido no processo principal do Electron pelo IPC (sem porta
 * de rede). Par da função ligarAgenteAoIpc de @fiscal/agente/electron.
 *
 *   // preload
 *   contextBridge.exposeInMainWorld("fiscal", {
 *     chamar: (pedido) => ipcRenderer.invoke("fiscal:fetch", pedido),
 *   });
 *   // tela
 *   const cliente = criarClienteFiscal({ url: "fiscal://local", fetch: fetchPeloIpc(window.fiscal.chamar) });
 */
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

export function fetchPeloIpc(chamar: (pedido: PedidoIpc) => Promise<RespostaIpc>): typeof fetch {
  return (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const cabecalhos: [string, string][] = [];
    new Headers(init.headers).forEach((valor, nome) => cabecalhos.push([nome, valor]));
    let corpo: string | Uint8Array | null = null;
    if (init.body !== undefined && init.body !== null) {
      corpo =
        typeof init.body === "string"
          ? init.body
          : new Uint8Array(await new Response(init.body).arrayBuffer());
    }
    const r = await chamar({ url, metodo: init.method ?? "GET", cabecalhos, corpo });
    const semCorpo = r.status === 204 || r.status === 304;
    return new Response(semCorpo ? null : (r.corpo as BodyInit), {
      status: r.status,
      headers: r.cabecalhos,
    });
  }) as typeof fetch;
}
