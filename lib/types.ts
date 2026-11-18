export type Company = {
  cnpj: string;
  name: string;
  legalName: string;
  city: string;
  state: string;
  site: string;
  domain: string;
  whatsappUrl: string;
  whatsappNumber: string | null;
  whatsappEvidence: string;
  cnpjEvidence: string;
  foundAt: string;
};
export type SearchStats = {
  candidates: number;
  sitesAnalyzed: number;
  withWhatsappAndCnpj: number;
  headquartersActive: number;
  approved: number;
};
export type SearchResponse = {
  companies: Company[];
  stats: SearchStats;
  nextCursor: number;
  exhausted: boolean;
  warning?: string;
};
