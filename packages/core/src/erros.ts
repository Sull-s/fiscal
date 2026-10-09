/**
 * Erro padrão de todos os pacotes fiscais.
 * `codigo` é estável e pode ser usado pelo sistema do cliente para decidir o que fazer;
 * `message` é texto para humanos.
 */
export class ErroFiscal extends Error {
  readonly codigo: string;
  readonly detalhes: Record<string, unknown> | undefined;

  constructor(codigo: string, mensagem: string, detalhes?: Record<string, unknown>) {
    super(mensagem);
    this.name = "ErroFiscal";
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}
