import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CancelarNota } from "./CancelarNota";
import { ConfigurarEmissor } from "./ConfigurarEmissor";
import { EmissorNfce } from "./EmissorNfce";
import { ListaNotas } from "./ListaNotas";
import { NotasRecebidas } from "./NotasRecebidas";
import { RelatorioContador } from "./RelatorioContador";
import { ErroApi, criarClienteFiscal } from "./cliente";
import { ProvedorFiscal } from "./comum";
import { fetchPeloIpc } from "./ipc";

/** API simulada: registra as chamadas e responde conforme a rota. */
function apiFalsa(rotas: Record<string, (corpo: unknown, cab: Headers) => [number, unknown]>) {
  const chamadas: { metodo: string; caminho: string; corpo: unknown; cab: Headers }[] = [];
  const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const caminho = String(url).replace("https://api.teste", "");
    const metodo = init?.method ?? "GET";
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    const cab = new Headers(init?.headers);
    chamadas.push({ metodo, caminho, corpo, cab });
    const rota = Object.keys(rotas).find((r) => `${metodo} ${caminho}`.startsWith(r));
    const [status, resposta] = rota
      ? (rotas[rota]?.(corpo, cab) ?? [404, {}])
      : [404, { erro: { codigo: "X", mensagem: "rota" } }];
    const binario = resposta instanceof Blob;
    return new Response(binario ? resposta : JSON.stringify(resposta), {
      status,
      headers: { "Content-Type": binario ? "application/pdf" : "application/json" },
    });
  });
  const cliente = criarClienteFiscal({
    url: "https://api.teste/",
    chave: "fsk_teste.abc",
    fetch: fetchFalso as unknown as typeof fetch,
  });
  return { cliente, chamadas };
}

const relatorio = {
  periodo: "2026-10",
  ambiente: 1,
  faturamento: 150,
  grupos: [],
  notas: [
    {
      modelo: "65",
      serie: "1",
      numero: 10,
      dataEmissao: "2026-10-10T12:00:00-03:00",
      chave: "4326A",
      situacao: "autorizada",
      valor: 100,
    },
    {
      modelo: "65",
      serie: "1",
      numero: 11,
      dataEmissao: "2026-10-11T12:00:00-03:00",
      chave: "4326B",
      situacao: "cancelada",
      valor: 30,
    },
    {
      modelo: "55",
      serie: "1",
      numero: 5,
      dataEmissao: "2026-10-12T12:00:00-03:00",
      chave: "4326C",
      situacao: "autorizada",
      valor: 50,
    },
  ],
};

beforeAll(() => {
  // jsdom não gera URLs de arquivo
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("cliente da API", () => {
  it("manda a chave, o Idempotency-Key e devolve a nota; 422 de validação vira ErroApi explicado", async () => {
    const { cliente, chamadas } = apiFalsa({
      "POST /v1/nfce": (corpo) =>
        (corpo as { venda: { itens: unknown[] } }).venda.itens.length
          ? [201, { chave: "4326", numero: 1, situacao: "autorizada" }]
          : [
              422,
              {
                erro: {
                  codigo: "NFCE_VENDA_INVALIDA",
                  mensagem: "x",
                  detalhes: { problemas: ["A venda não tem itens."] },
                },
              },
            ],
    });
    const r = await cliente.emitirNfce({ itens: [{}], pagamentos: [] }, "venda-1");
    expect(r).toMatchObject({ numero: 1, situacao: "autorizada" });
    expect(chamadas[0]?.cab.get("Authorization")).toBe("Bearer fsk_teste.abc");
    expect(chamadas[0]?.cab.get("Idempotency-Key")).toBe("venda-1");
    const erro = await cliente.emitirNfce({ itens: [], pagamentos: [] }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({ status: 422, codigo: "NFCE_VENDA_INVALIDA" });
  });

  it("NFC-e rejeitada pela SEFAZ (422 com a nota) volta como resultado, não como erro", async () => {
    const { cliente } = apiFalsa({
      "POST /v1/nfce": () => [
        422,
        { situacao: "rejeitada", cStat: "778", motivo: "NCM inexistente" },
      ],
    });
    expect(await cliente.emitirNfce({ itens: [{}] })).toMatchObject({
      situacao: "rejeitada",
      cStat: "778",
    });
  });
});

describe("ListaNotas", () => {
  it("mostra as notas, o total e cancela com justificativa de 15 caracteres", async () => {
    const { cliente, chamadas } = apiFalsa({
      "GET /v1/relatorios/2026/10": () => [200, relatorio],
      "POST /v1/nfce/4326A/cancelamento": () => [200, { situacao: "cancelada" }],
    });
    render(
      <ProvedorFiscal cliente={cliente}>
        <ListaNotas ano={2026} mes={10} />
      </ProvedorFiscal>,
    );
    expect(await screen.findByText("Total autorizado: R$ 150,00")).toBeTruthy();
    expect(screen.getAllByText("Autorizada")).toHaveLength(2);
    // Só as autorizadas podem ser canceladas
    const cancelar = screen.getAllByRole("button", { name: "Cancelar" });
    expect(cancelar).toHaveLength(2);
    // A NF-e (mais nova) vem primeiro; a NFC-e 10 é o segundo "Cancelar"
    fireEvent.click(cancelar[1]!);
    const confirmar = screen.getByRole("button", { name: "Cancelar nota" }) as HTMLButtonElement;
    const motivo = screen.getByLabelText("Motivo do cancelamento");
    fireEvent.change(motivo, { target: { value: "curto" } });
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(motivo, { target: { value: "Cliente desistiu da compra" } });
    expect(confirmar.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(confirmar);
    });
    await waitFor(() =>
      expect(chamadas.some((c) => c.caminho === "/v1/nfce/4326A/cancelamento")).toBe(true),
    );
    const pedido = chamadas.find((c) => c.caminho === "/v1/nfce/4326A/cancelamento");
    expect(pedido?.corpo).toEqual({ justificativa: "Cliente desistiu da compra" });
    // Recarrega a lista depois de cancelar
    await waitFor(() =>
      expect(chamadas.filter((c) => c.caminho.startsWith("/v1/relatorios")).length).toBe(2),
    );
  });

  it("mostra o erro da API em vez de quebrar", async () => {
    const { cliente } = apiFalsa({
      "GET /v1/relatorios": () => [503, { erro: { codigo: "X", mensagem: "API fora do ar" } }],
    });
    render(
      <ProvedorFiscal cliente={cliente}>
        <ListaNotas ano={2026} mes={10} />
      </ProvedorFiscal>,
    );
    expect((await screen.findByRole("alert")).textContent).toBe("API fora do ar");
  });
});

describe("EmissorNfce", () => {
  const itens = [
    { descricao: "Prato feito", ncm: "21069090", cfop: "5102", quantidade: 2, valorUnitario: 25 },
    {
      descricao: "Refrigerante",
      ncm: "22021000",
      cfop: "5405",
      quantidade: 1,
      valorUnitario: 6.5,
      csosn: "500",
      cest: "0300700",
    },
  ];

  it("soma o total, calcula o troco, emite em dinheiro e avisa a contingência offline", async () => {
    const { cliente, chamadas } = apiFalsa({
      "POST /v1/nfce": () => [202, { chave: "4326X", numero: 42, situacao: "offline", troco: 3.5 }],
    });
    const emitida = vi.fn();
    render(
      <ProvedorFiscal cliente={cliente}>
        <EmissorNfce itens={itens} onEmitida={emitida} chaveIdempotencia="pedido-9" />
      </ProvedorFiscal>,
    );
    expect(screen.getByText("R$ 56,50")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Valor recebido"), { target: { value: "60" } });
    expect(screen.getByText("Troco: R$ 3,50")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("CPF na nota (opcional)"), {
      target: { value: "123.456.789-09" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Emitir NFC-e" }));
    });
    expect(chamadas[0]?.corpo).toEqual({
      venda: {
        itens,
        pagamentos: [{ forma: "dinheiro", valor: 60 }],
        destinatario: { documento: "12345678909" },
      },
    });
    expect(chamadas[0]?.cab.get("Idempotency-Key")).toBe("pedido-9");
    expect(await screen.findByText(/Emitida em contingência/)).toBeTruthy();
    expect(emitida).toHaveBeenCalledWith(expect.objectContaining({ numero: 42 }));
    // Depois de emitida, não dá para emitir de novo
    expect(screen.queryByRole("button", { name: "Emitir NFC-e" })).toBeNull();
  });

  it("não deixa emitir com valor recebido menor e mostra a rejeição da SEFAZ", async () => {
    const { cliente } = apiFalsa({
      "POST /v1/nfce": () => [
        422,
        { situacao: "rejeitada", cStat: "778", motivo: "NCM inexistente" },
      ],
    });
    render(
      <ProvedorFiscal cliente={cliente}>
        <EmissorNfce itens={itens} />
      </ProvedorFiscal>,
    );
    const botao = screen.getByRole("button", { name: "Emitir NFC-e" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Valor recebido"), { target: { value: "10" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Forma de pagamento"), { target: { value: "pix" } });
    expect(botao.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(botao);
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "A SEFAZ recusou a nota (778)",
    );
  });
});

describe("NotasRecebidas e RelatorioContador", () => {
  it("lista notas de fornecedores e manifesta a confirmação", async () => {
    let manifestada = false;
    const { cliente, chamadas } = apiFalsa({
      "GET /v1/dfe/notas": () => [
        200,
        [
          {
            chave: "35X",
            emitente: { documento: "1", nome: "Fornecedor SP" },
            valor: 1500,
            xmlCompleto: true,
            ...(manifestada ? { manifestacao: { tipo: "confirmacao", em: "x" } } : {}),
          },
        ],
      ],
      "POST /v1/dfe/notas/35X/manifestacao": () => {
        manifestada = true;
        return [200, { registrado: true }];
      },
    });
    render(
      <ProvedorFiscal cliente={cliente}>
        <NotasRecebidas />
      </ProvedorFiscal>,
    );
    expect(await screen.findByText("Fornecedor SP")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    });
    await waitFor(() =>
      expect(screen.getByText("Confirmar recebimento", { selector: "td" })).toBeTruthy(),
    );
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ tipo: "confirmacao" });
  });

  it("baixa o PDF do mês escolhido", async () => {
    const { cliente, chamadas } = apiFalsa({
      "GET /v1/relatorios/2026/9": () => [200, new Blob(["%PDF-"], { type: "application/pdf" })],
    });
    render(
      <ProvedorFiscal cliente={cliente}>
        <RelatorioContador inicial={{ ano: 2026, mes: 9 }} />
      </ProvedorFiscal>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Relatório em PDF" }));
    });
    expect(chamadas[0]?.caminho).toBe("/v1/relatorios/2026/9");
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("CancelarNota de NFS-e manda o campo motivo", async () => {
    const { cliente, chamadas } = apiFalsa({ "POST /v1/nfse/ABC/cancelamento": () => [200, {}] });
    const ok = vi.fn();
    render(
      <ProvedorFiscal cliente={cliente}>
        <CancelarNota modelo="nfse" chave="ABC" onFechar={() => {}} onCancelada={ok} />
      </ProvedorFiscal>,
    );
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), {
      target: { value: "Servico nao foi prestado" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancelar nota" }));
    });
    expect(chamadas[0]?.corpo).toEqual({ motivo: "Servico nao foi prestado" });
    expect(ok).toHaveBeenCalled();
  });
});

describe("ConfigurarEmissor", () => {
  it("explica o que falta, salva empresa e certificado (só no emissor) e testa a SEFAZ", async () => {
    const { cliente, chamadas } = apiFalsa({
      "GET /v1/admin/empresas/principal": () => [404, { erro: { codigo: "X", mensagem: "x" } }],
      "PUT /v1/admin/empresas/principal/certificado": () => [
        200,
        {
          titular: "LOJA TESTE",
          documento: "48618635000183",
          validoAte: "2027-08-26T00:00:00Z",
          situacao: "valido",
          diasRestantes: 300,
        },
      ],
      "PUT /v1/admin/empresas/principal": (corpo) => [
        201,
        { id: "principal", certificado: null, ...(corpo as object) },
      ],
      "GET /v1/sefaz/status": () => [
        200,
        {
          emOperacao: true,
          cStat: "107",
          xMotivo: "Servico em Operacao",
          diferencaRelogioSegundos: 2,
        },
      ],
    });
    const salvo = vi.fn();
    render(
      <ProvedorFiscal cliente={cliente}>
        <ConfigurarEmissor buscarCep={null} onSalvo={salvo} />
      </ProvedorFiscal>,
    );
    await screen.findByText("Configurar nota fiscal");

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByText("Anexe o certificado digital A1 (.pfx).")).toBeTruthy();
    expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(0);

    const preencher = (rotulo: string, valor: string) =>
      fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
    preencher("CNPJ", "48.618.635/0001-83");
    preencher("Razão social", "Loja Teste");
    preencher("Inscrição estadual", "0960000000");
    preencher("CEP", "91450-510");
    preencher("Rua", "Av. Teste");
    preencher("Número", "39");
    preencher("Bairro", "Centro");
    preencher("Cidade", "Porto Alegre");
    preencher("UF", "rs");
    preencher("Código IBGE da cidade", "4314902");
    const pfx = new File([new Uint8Array([1, 2, 3, 250])], "cert.pfx");
    fireEvent.change(screen.getByLabelText("Arquivo do certificado (.pfx)"), {
      target: { files: [pfx] },
    });
    preencher("Senha do certificado", "segredo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await screen.findByText("Configuração salva.");
    const [empresa, certificado] = chamadas.filter((c) => c.metodo === "PUT");
    expect(empresa?.corpo).toMatchObject({
      cnpj: "48618635000183",
      ambiente: 2,
      nfce: {
        serie: "1",
        contingenciaOffline: true,
        emitente: {
          cnpj: "48618635000183",
          crt: 1,
          endereco: { cep: "91450510", uf: "RS", codigoMunicipio: "4314902" },
        },
      },
    });
    expect(certificado?.corpo).toEqual({ pfxBase64: btoa("ú"), senha: "segredo" });
    expect(salvo).toHaveBeenCalled();
    expect(screen.getByText("LOJA TESTE")).toBeTruthy();
    // A senha não fica na tela depois de enviada
    expect((screen.getByLabelText("Senha do certificado") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Testar com a SEFAZ" }));
    await screen.findByText(/SEFAZ: no ar/);
  });
});

describe("fetchPeloIpc", () => {
  it("converte fetch em pedido IPC e a resposta de volta (inclusive binário e 204)", async () => {
    const pedidos: unknown[] = [];
    const f = fetchPeloIpc(async (p) => {
      pedidos.push(p);
      if (p.url.endsWith("/vazio")) return { status: 204, cabecalhos: [], corpo: new Uint8Array() };
      return {
        status: 200,
        cabecalhos: [["content-type", "application/pdf"]],
        corpo: new Uint8Array([37, 80, 68, 70]),
      };
    });
    const r = await f("fiscal://local/v1/nfe/1/danfe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(pedidos[0]).toEqual({
      url: "fiscal://local/v1/nfe/1/danfe",
      metodo: "POST",
      cabecalhos: [["content-type", "application/json"]],
      corpo: '{"a":1}',
    });
    expect((await f("fiscal://local/vazio")).status).toBe(204);
  });
});
