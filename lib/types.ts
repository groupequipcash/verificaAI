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
  googleSites: number;
  sitesAnalyzed: number;
  withWhatsapp: number;
  withCnpj: number;
  cnpjsQueried: number;
  rejectedBranch: number;
  rejectedInactive: number;
  siteErrors: number;
  registryErrors: number;
  rejectedAssociation: number;
  headquartersActive: number;
  approved: number;
};
export const emptyStats = (): SearchStats => ({
  googleSites: 0,
  sitesAnalyzed: 0,
  withWhatsapp: 0,
  withCnpj: 0,
  cnpjsQueried: 0,
  rejectedBranch: 0,
  rejectedInactive: 0,
  siteErrors: 0,
  registryErrors: 0,
  rejectedAssociation: 0,
  headquartersActive: 0,
  approved: 0,
});
