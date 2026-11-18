import { isValidCnpj } from "./cnpj-extractor";
import { classifyRegistration } from "./registration-classifier";
export type Registration = {
  cnpj: string;
  nome_fantasia?: string;
  razao_social?: string;
  municipio?: string;
  uf?: string;
  identificador_matriz_filial?: number | string;
  descricao_identificador_matriz_filial?: string;
  descricao_situacao_cadastral?: string;
};
export type RegistrationResult =
  | { status: "approved"; data: Registration }
  | {
      status:
        | "branch"
        | "inactive"
        | "unconfirmed"
        | "not_found"
        | "unavailable"
        | "timeout";
    };
export async function getRegistration(
  cnpj: string,
): Promise<RegistrationResult> {
  if (!isValidCnpj(cnpj)) return { status: "unconfirmed" };
  try {
    const res = await fetch(
      `https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`,
      { signal: AbortSignal.timeout(5500), cache: "no-store" },
    );
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "unavailable" };
    const data = (await res.json()) as Registration;
    const status = classifyRegistration(data);
    if (status !== "approved") return { status };
    return { status: "approved", data };
  } catch (error) {
    return {
      status:
        error instanceof Error &&
        /timeout|abort/i.test(error.name + " " + error.message)
          ? "timeout"
          : "unavailable",
    };
  }
}
