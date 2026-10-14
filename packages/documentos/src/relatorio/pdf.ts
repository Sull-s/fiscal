import PDFDocument from "pdfkit";
import { dataHora, documento, moeda } from "../formato";

/** "14/10/2026 10:32" no horário de Brasília (o servidor pode estar em UTC) */
const horaDeBrasilia = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  })
    .format(d)
    .replace(",", "");

/**
 * Relatório mensal de notas para o contador (PDF A4): resumo por modelo e situação e a lista de
 * todas as notas do período. É um resumo de conferência; os XMLs (ZIP do mês) continuam sendo os
 * documentos fiscais.
 */

export interface LinhaRelatorio {
  /** "55" NF-e · "65" NFC-e · "nfse" */
  modelo: string;
  serie: string;
  numero: number;
  dataEmissao: string;
  chave?: string;
  situacao: string;
  valor: number;
}

export interface DadosRelatorio {
  empresa: { nome: string; cnpj: string };
  /** AAAA-MM */
  periodo: string;
  ambiente: 1 | 2;
  notas: LinhaRelatorio[];
  geradoEm?: Date;
}

const NOME_MODELO: Record<string, string> = { "55": "NF-e", "65": "NFC-e", nfse: "NFS-e" };
const NOME_SITUACAO: Record<string, string> = {
  autorizada: "Autorizada",
  cancelada: "Cancelada",
  denegada: "Denegada",
  pendente: "Pendente",
  offline: "Offline (a transmitir)",
  "offline-rejeitada": "Offline rejeitada",
  "nao-recebida": "Não recebida",
};
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const A4 = { w: 595.28, h: 841.89 };
const M = 36;
const LARG = A4.w - 2 * M;

/** Resumo: quantidade e valor por modelo e situação (só autorizadas entram no faturamento). */
export function resumirNotas(notas: LinhaRelatorio[]) {
  const grupos = new Map<
    string,
    { modelo: string; situacao: string; quantidade: number; valor: number }
  >();
  for (const n of notas) {
    const k = `${n.modelo}|${n.situacao}`;
    const g = grupos.get(k) ?? { modelo: n.modelo, situacao: n.situacao, quantidade: 0, valor: 0 };
    g.quantidade++;
    g.valor = Math.round((g.valor + n.valor) * 100) / 100;
    grupos.set(k, g);
  }
  const faturamento = notas
    .filter((n) => n.situacao === "autorizada")
    .reduce((s, n) => Math.round((s + n.valor) * 100) / 100, 0);
  return {
    grupos: [...grupos.values()].sort((a, b) =>
      `${a.modelo}${a.situacao}`.localeCompare(`${b.modelo}${b.situacao}`),
    ),
    faturamento,
  };
}

export async function gerarRelatorioNotas(
  d: DadosRelatorio,
  opcoes: { comprimir?: boolean } = {},
): Promise<Buffer> {
  const [ano, mes] = d.periodo.split("-");
  const titulo = `Notas fiscais de ${MESES[Number(mes) - 1] ?? mes} de ${ano}`;
  const doc = new PDFDocument({
    size: "A4",
    margin: M,
    compress: opcoes.comprimir ?? true,
    info: { Title: `${titulo} - ${d.empresa.nome}`, Creator: "@fiscal/documentos" },
  });
  const pedacos: Buffer[] = [];
  doc.on("data", (c: Buffer) => pedacos.push(c));
  const pronto = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(pedacos))));

  doc.font("Helvetica-Bold").fontSize(15).text(titulo);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#444")
    .text(`${d.empresa.nome} · CNPJ ${documento(d.empresa.cnpj)}`)
    .text(
      `${d.ambiente === 1 ? "Produção" : "HOMOLOGAÇÃO (sem valor fiscal)"} · gerado em ${horaDeBrasilia(d.geradoEm ?? new Date())} (Brasília)`,
    )
    .fillColor("#000")
    .moveDown(1);

  // Resumo
  const { grupos, faturamento } = resumirNotas(d.notas);
  doc.font("Helvetica-Bold").fontSize(11).text("Resumo").moveDown(0.3);
  const colResumo = [120, 180, 90, LARG - 390];
  const linha = (
    cels: string[],
    larguras: number[],
    negrito = false,
    alinhar: ("left" | "right")[] = [],
  ) => {
    const y = doc.y;
    let x = M;
    doc.font(negrito ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
    cels.forEach((c, i) => {
      // Chave de acesso (44 dígitos) só cabe na coluna com fonte menor
      doc.fontSize(/^\d{40,}$/.test(c) ? 6.4 : 8.5);
      doc.text(c, x + 3, y + (/^\d{40,}$/.test(c) ? 1.5 : 0), {
        width: (larguras[i] ?? 50) - 6,
        align: alinhar[i] ?? "left",
        lineBreak: false,
      });
      x += larguras[i] ?? 50;
    });
    doc.y = y + 13;
    doc
      .moveTo(M, doc.y - 2)
      .lineTo(M + LARG, doc.y - 2)
      .lineWidth(0.3)
      .stroke("#ccc");
  };
  linha(["Documento", "Situação", "Quantidade", "Valor (R$)"], colResumo, true, [
    "left",
    "left",
    "right",
    "right",
  ]);
  for (const g of grupos) {
    linha(
      [
        NOME_MODELO[g.modelo] ?? g.modelo,
        NOME_SITUACAO[g.situacao] ?? g.situacao,
        String(g.quantidade),
        moeda(g.valor),
      ],
      colResumo,
      false,
      ["left", "left", "right", "right"],
    );
  }
  if (grupos.length === 0) doc.font("Helvetica").fontSize(9).text("Nenhuma nota no período.");
  doc.moveDown(0.5);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`Total autorizado: R$ ${moeda(faturamento)}`, M, doc.y, { width: LARG, align: "right" })
    .moveDown(1.2);

  // Lista
  doc.font("Helvetica-Bold").fontSize(11).text("Notas do período", M).moveDown(0.3);
  const col = [44, 32, 52, 70, 210, 60, LARG - 468];
  const alinhar: ("left" | "right")[] = ["left", "right", "right", "left", "left", "left", "right"];
  const cabecalho = () =>
    linha(
      ["Doc.", "Série", "Número", "Emissão", "Chave", "Situação", "Valor (R$)"],
      col,
      true,
      alinhar,
    );
  cabecalho();
  const ordenadas = [...d.notas].sort(
    (a, b) =>
      a.modelo.localeCompare(b.modelo) || a.serie.localeCompare(b.serie) || a.numero - b.numero,
  );
  for (const n of ordenadas) {
    if (doc.y > A4.h - M - 20) {
      doc.addPage();
      cabecalho();
    }
    linha(
      [
        NOME_MODELO[n.modelo] ?? n.modelo,
        n.serie,
        String(n.numero),
        dataHora(n.dataEmissao).slice(0, 10),
        n.chave ?? "",
        NOME_SITUACAO[n.situacao] ?? n.situacao,
        moeda(n.valor),
      ],
      col,
      false,
      alinhar,
    );
  }
  doc.end();
  return pronto;
}
