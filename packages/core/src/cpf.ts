/** Remove pontuação: "529.982.247-25" → "52998224725". */
export function limparCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

function digito(base: string, pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) {
    soma += Number(base[i]) * (pesoInicial - i);
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

export function validarCpf(cpf: string): boolean {
  const limpo = limparCpf(cpf);
  if (!/^\d{11}$/.test(limpo)) return false;
  // Sequências repetidas passam no cálculo, mas não existem
  if (/^(\d)\1{10}$/.test(limpo)) return false;

  const dv1 = digito(limpo.slice(0, 9), 10);
  const dv2 = digito(limpo.slice(0, 10), 11);
  return limpo.endsWith(`${dv1}${dv2}`);
}

/** "52998224725" → "529.982.247-25" */
export function formatarCpf(cpf: string): string {
  const limpo = limparCpf(cpf);
  return limpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}
