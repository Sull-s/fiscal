import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CANAL_FISCAL, type PedidoIpc, type RespostaIpc, ligarAgenteAoIpc } from "./electron";
import { type Agente, chaveMestraProtegida, iniciarAgente } from "./index";

const pasta = mkdtempSync(join(tmpdir(), "fiscal-agente-"));
const PFX = readFileSync(
  join(import.meta.dirname, "..", "testes", "fixtures", "certificado-teste.pfx"),
);
// Proteção falsa (o Electron usa safeStorage/DPAPI): só para provar que o arquivo não fica em claro
const proteger = (t: string) =>
  new TextEncoder().encode(`cifrado:${Buffer.from(t).toString("hex")}`);
const abrir = (b: Buffer) => Buffer.from(b.toString().replace("cifrado:", ""), "hex").toString();

let agente: Agente;
beforeAll(async () => {
  agente = await iniciarAgente({
    pastaDados: join(pasta, "dados"),
    chaveMestra: () => chaveMestraProtegida({ arquivo: join(pasta, "chave.bin"), proteger, abrir }),
    aoRegistrar: () => {},
  });
});
afterAll(async () => {
  await agente.parar();
  rmSync(pasta, { recursive: true, force: true });
});

const json = (corpo: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});

describe("emissor embutido", () => {
  it("chave mestra: gerada uma vez, guardada cifrada e lida de volta igual", async () => {
    const arquivo = join(pasta, "chave.bin");
    const lida = await chaveMestraProtegida({ arquivo, proteger, abrir });
    expect(Buffer.from(lida, "base64")).toHaveLength(32);
    expect(readFileSync(arquivo, "utf8")).not.toContain(lida);
    expect(await chaveMestraProtegida({ arquivo, proteger, abrir })).toBe(lida);
    // Formato do safeStorage assíncrono: { result, shouldReEncrypt } regrava cifrado de novo
    const outra = join(pasta, "chave-2.bin");
    const criada = await chaveMestraProtegida({ arquivo: outra, proteger, abrir });
    let regravou = false;
    const lidaDeNovo = await chaveMestraProtegida({
      arquivo: outra,
      proteger: (t) => {
        regravou = true;
        return proteger(t);
      },
      abrir: async (b) => ({ result: abrir(b), shouldReEncrypt: true }),
    });
    expect(lidaDeNovo).toBe(criada);
    expect(regravou).toBe(true);
  });

  it("antes de configurar: avisa que falta configurar, sem token nenhum na mão do app", async () => {
    expect(await agente.configurado()).toBe(false);
    const r = await agente.fetch("/v1/nfce", { method: "POST", body: "{}" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { erro: { codigo: string } }).erro.codigo).toBe(
      "EMISSOR_NAO_CONFIGURADO",
    );
  });

  it("a tela de configuração grava empresa e A1 pelas rotas de admin; depois as rotas de venda funcionam", async () => {
    const empresa = await agente.fetch(
      "/v1/admin/empresas/principal",
      json({
        nome: "Comida Caseira da Rose",
        cnpj: "48618635000183",
        ambiente: 2,
        nfce: {
          serie: "1",
          contingenciaOffline: true,
          emitente: {
            cnpj: "48618635000183",
            inscricaoEstadual: "0960000000",
            razaoSocial: "Rosemeri Teresinha Muller Correa",
            crt: 4,
            endereco: {
              logradouro: "Av. Mae Apolinaria Matias Batista",
              numero: "39",
              bairro: "Morro Santana",
              codigoMunicipio: "4314902",
              municipio: "Porto Alegre",
              uf: "RS",
              cep: "91450510",
            },
          },
        },
      }),
    );
    expect(empresa.status).toBeLessThan(300);
    const cert = await agente.fetch(
      "/v1/admin/empresas/principal/certificado",
      json({ pfxBase64: PFX.toString("base64"), senha: "senha-teste" }),
    );
    expect(cert.status).toBe(200);
    expect(await agente.configurado()).toBe(true);

    const dados = (await (await agente.fetch("/v1/empresa")).json()) as {
      cnpj: string;
      certificado: { documento: string };
    };
    expect(dados).toMatchObject({ cnpj: "48618635000183" });
    // O cadastro guardado no disco não tem a senha nem o certificado em claro
    const arquivoEmpresa = readFileSync(
      join(pasta, "dados", "arquivos", "_empresas", "principal.json"),
      "utf8",
    );
    expect(arquivoEmpresa).not.toContain("senha-teste");
    expect(arquivoEmpresa).not.toContain(PFX.toString("base64").slice(0, 40));
  });

  it("ponte IPC do Electron: só a API fiscal passa, e o token nunca vem da tela", async () => {
    let atender: ((e: unknown, p: PedidoIpc) => Promise<RespostaIpc>) | undefined;
    const desligar = ligarAgenteAoIpc(
      {
        handle: (canal, f) => {
          expect(canal).toBe(CANAL_FISCAL);
          atender = f;
        },
        removeHandler: () => {
          atender = undefined;
        },
      },
      agente,
    );
    const pedir = (url: string, cabecalhos: [string, string][] = []) =>
      atender?.(null, { url, metodo: "GET", cabecalhos, corpo: null }) as Promise<RespostaIpc>;

    const ok = await pedir("fiscal://local/v1/empresa");
    expect(ok.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(ok.corpo))).toMatchObject({ id: "principal" });
    // Authorization vindo da tela é descartado (a autenticação é só do processo principal)
    expect((await pedir("/v1/empresa", [["Authorization", "Bearer falsa"]])).status).toBe(200);
    expect((await pedir("https://site-qualquer.com/roubar")).status).toBe(404);
    desligar();
    expect(atender).toBeUndefined();
  });
});
