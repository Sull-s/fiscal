# fiscal — regras do projeto

- Tudo em português: código (nomes de funções, variáveis, tipos), comentários, docs e mensagens de erro.
  Exceção: nomes que vêm dos schemas oficiais (cUF, nNF, tpEmis…) aparecem só em comentários
  ou no pacote de XML; a API pública usa nomes em português claro (`numero`, `tipoEmissao`).
- Gerenciador: `pnpm` (nunca npm/yarn dentro do monorepo). Antes de concluir qualquer mudança:
  `pnpm verificar`.
- Novo pacote: copiar a estrutura de `packages/core` (package.json com exports ESM+CJS, tsup,
  tsconfig estendendo `tsconfig.base.json`, testes `*.test.ts` ao lado do código).
- `@fiscal/core` não pode importar nada de rede, disco ou bibliotecas pesadas.
- Erros: lançar `ErroFiscal(codigo, mensagem, detalhes)` com `codigo` em MAIÚSCULAS_COM_UNDERLINE.
- Regra fiscal nova = teste primeiro. Sempre que possível usar XML/chave real já autorizado como fixture.
- Código de referência (antigo, em produção): `C:\Users\agili\Desktop\apis\mp-marketplace-oauth\lib\nfce`
  (NFC-e RS) e `C:\Users\agili\Desktop\apis\nfse-nacional-teste` (NFS-e Nacional). Ler para entender
  as regras e pegadinhas; não copiar e colar.
- Nunca versionar certificados, chaves, CSC ou `.env`.
