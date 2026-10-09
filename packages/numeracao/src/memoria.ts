import type { ArmazemNumeracao, RegistroNumero, Serie } from "./tipos";

const chave = (s: Serie) => `${s.empresa}|${s.modelo}|${s.ambiente}|${s.serie}`;

/**
 * Armazém em memória: para testes e protótipos. Some quando o processo reinicia.
 * É atômico porque o JavaScript roda as funções síncronas sem interrupção.
 */
export function armazemEmMemoria(): ArmazemNumeracao {
  const proximos = new Map<string, number>();
  const numeros = new Map<string, Map<number, RegistroNumero>>();
  const daSerie = (s: Serie) => {
    const k = chave(s);
    let m = numeros.get(k);
    if (!m) {
      m = new Map();
      numeros.set(k, m);
    }
    return m;
  };

  return {
    async reservar(serie, inicio, referencia) {
      const registros = daSerie(serie);
      const liberado = [...registros.values()]
        .filter((r) => r.situacao === "liberado")
        .sort((a, b) => a.numero - b.numero)[0];
      const numero = liberado?.numero ?? proximos.get(chave(serie)) ?? inicio;
      if (!liberado) proximos.set(chave(serie), numero + 1);
      registros.set(numero, {
        numero,
        situacao: "reservado",
        ...(referencia ? { referencia } : {}),
        atualizadoEm: new Date(),
      });
      return numero;
    },
    async atualizar(serie, numero, situacao, referencia) {
      const registros = daSerie(serie);
      const atual = registros.get(numero);
      const ref = referencia ?? atual?.referencia;
      registros.set(numero, {
        numero,
        situacao,
        ...(ref ? { referencia: ref } : {}),
        atualizadoEm: new Date(),
      });
      // Número registrado à frente da sequência (ex.: inutilização antecipada) empurra o próximo
      const proximo = proximos.get(chave(serie));
      if (proximo === undefined || numero >= proximo) proximos.set(chave(serie), numero + 1);
    },
    async proximo(serie) {
      return proximos.get(chave(serie)) ?? null;
    },
    async listar(serie) {
      return [...daSerie(serie).values()]
        .sort((a, b) => a.numero - b.numero)
        .map((r) => ({ ...r }));
    },
  };
}
