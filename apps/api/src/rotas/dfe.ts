import type { TipoManifestacao } from "@fiscal/dfe";
import { type Context, Hono } from "hono";
import { type Ambiente, falhar, lerCorpo } from "../http";
import {
  lerNotaRecebida,
  listarNotasRecebidas,
  manifestarNota,
  sincronizarDfe,
  xmlNotaRecebida,
} from "../servicos/dfe";
import type { Operacao } from "../servicos/nfce";

const TIPOS: TipoManifestacao[] = ["ciencia", "confirmacao", "desconhecimento", "nao-realizada"];

/** Notas emitidas contra o CNPJ da empresa (fornecedores) e manifestação do destinatário. */
export function rotasDfe() {
  const app = new Hono<Ambiente>();
  const op = (c: Context<Ambiente>): Operacao => ({ ctx: c.get("ctx"), empresa: c.get("empresa") });

  /** Busca agora o que há de novo (respeita a espera de 1 hora da Receita). */
  app.post("/sincronizar", async (c) => c.json(await sincronizarDfe(op(c))));

  app.get("/notas", async (c) => c.json(await listarNotasRecebidas(op(c))));

  app.get("/notas/:chave", async (c) => {
    const nota = await lerNotaRecebida(op(c), c.req.param("chave"));
    return nota
      ? c.json(nota)
      : falhar(404, "NOTA_NAO_ENCONTRADA", "Nota recebida não encontrada.");
  });

  /** XML completo (só depois da ciência/confirmação e da próxima sincronização). */
  app.get("/notas/:chave/xml", async (c) => {
    const xml = await xmlNotaRecebida(op(c), c.req.param("chave"));
    return xml
      ? c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8" })
      : falhar(
          404,
          "XML_NAO_DISPONIVEL",
          "XML completo ainda não baixado: manifeste ciência ou confirmação e aguarde a próxima sincronização.",
        );
  });

  /** `{ tipo: "ciencia" | "confirmacao" | "desconhecimento" | "nao-realizada", justificativa? }` */
  app.post("/notas/:chave/manifestacao", async (c) => {
    const { tipo, justificativa } = await lerCorpo<{
      tipo?: TipoManifestacao;
      justificativa?: string;
    }>(c);
    if (!tipo || !TIPOS.includes(tipo)) {
      falhar(400, "MANIFESTACAO_INVALIDA", `Tipo deve ser um destes: ${TIPOS.join(", ")}.`);
    }
    const r = await manifestarNota(op(c), c.req.param("chave"), tipo, justificativa);
    if (!r.registrado && r.cStat !== "573") {
      return c.json({ erro: { codigo: `SEFAZ_${r.cStat}`, mensagem: r.motivo } }, 422);
    }
    return c.json({ registrado: true, cStat: r.cStat, motivo: r.motivo, protocolo: r.protocolo });
  });

  return app;
}
