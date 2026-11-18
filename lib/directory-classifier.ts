export function isDirectorySite(host: string, homeText: string) {
  const signals = [
    /guia\s+(?:de\s+)?(?:empresas|neg[oó]cios|servi[cç]os)/i,
    /(?:lista|diret[oó]rio|cat[aá]logo)\s+(?:de\s+)?(?:empresas|neg[oó]cios|profissionais)/i,
    /cadastre\s+(?:sua|a)\s+empresa/i,
    /encontre\s+(?:empresas|profissionais|fornecedores)/i,
  ];
  return (
    /^empresas\./i.test(host) ||
    signals.filter((pattern) => pattern.test(homeText)).length >= 2
  );
}
