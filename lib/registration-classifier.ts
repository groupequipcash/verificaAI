import type { Registration } from "./cnpj-provider";
export type RegistrationStatus =
  | "approved"
  | "branch"
  | "inactive"
  | "unconfirmed";
export function classifyRegistration(data: Registration): RegistrationStatus {
  const id = String(data.identificador_matriz_filial || "").trim();
  const kind = String(data.descricao_identificador_matriz_filial || "")
    .trim()
    .toUpperCase();
  const situation = String(data.descricao_situacao_cadastral || "")
    .trim()
    .toUpperCase();
  if (id === "2" || kind === "FILIAL") return "branch";
  if (situation && situation !== "ATIVA") return "inactive";
  if (id !== "1" || (kind && kind !== "MATRIZ") || situation !== "ATIVA")
    return "unconfirmed";
  return "approved";
}
