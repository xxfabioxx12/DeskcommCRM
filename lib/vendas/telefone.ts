/**
 * Telefone da venda em E.164 — a ordem de tentativas do `PhoneNormalizer` do
 * integrador (`app/Services/Phone/PhoneNormalizer.php:16-66`): com `+`, com o
 * DDI já embutido (12+ dígitos), com `00` no lugar do `+` e, por fim, como
 * número nacional da região da conexão. Inválido = nulo, nunca erro.
 *
 * Divergência D1 do plano: sem `libphonenumber`. O Brasil é validado pela regra
 * que o CRM já usa (`lib/channels/phone-variants.ts`) e sai na forma canônica do
 * CRM (celular COM o nono dígito); fora do Brasil vale o tamanho do E.164.
 */
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";

export const REGIOES_DO_TELEFONE = [
  "BR", "PT", "US", "CA", "ES", "MX", "AR", "CO", "CL", "PE", "UY", "PY", "BO", "EC", "GB", "DE", "FR", "IT",
] as const;
export type RegiaoDoTelefone = (typeof REGIOES_DO_TELEFONE)[number];

const DDI: Record<RegiaoDoTelefone, string> = {
  BR: "55", PT: "351", US: "1", CA: "1", ES: "34", MX: "52", AR: "54", CO: "57", CL: "56",
  PE: "51", UY: "598", PY: "595", BO: "591", EC: "593", GB: "44", DE: "49", FR: "33", IT: "39",
};

/** DDD 11–99; celular 9 + 8 dígitos; fixo (ou celular antigo) com 8 dígitos começando em 2–9. */
function brasileiroValido(semDdi: string): boolean {
  const ddd = semDdi.slice(0, 2);
  const local = semDdi.slice(2);
  if (!/^[1-9][1-9]$/.test(ddd)) return false;
  return /^9\d{8}$/.test(local) || /^[2-9]\d{7}$/.test(local);
}

function valido(candidato: string): string | null {
  const digitos = candidato.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(digitos)) return null;
  if (digitos.startsWith("55")) return brasileiroValido(digitos.slice(2)) ? canonicalPhoneBR(candidato) : null;
  return candidato;
}

export function telefoneE164(bruto: string | null | undefined, regiao: string = "BR"): string | null {
  if (typeof bruto !== "string" || bruto.trim() === "") return null;
  const temMais = bruto.trimStart().startsWith("+");
  const digitos = bruto.replace(/\D+/g, "");
  if (digitos.length < 8) return null;

  const candidatos: string[] = [];
  if (temMais || digitos.length >= 12) candidatos.push(`+${digitos}`);
  if (!temMais && digitos.startsWith("00") && digitos.length >= 12) candidatos.push(`+${digitos.slice(2)}`);
  const r = regiao.toUpperCase();
  if (!temMais && (REGIOES_DO_TELEFONE as readonly string[]).includes(r)) {
    // O 0 de tronco ("(011) ...", "07911 ...") sai em todas as regiões, menos na Itália, onde o 0 do fixo faz parte do número.
    const nacional = r === "IT" ? digitos : digitos.replace(/^0+/, "");
    candidatos.push(`+${DDI[r as RegiaoDoTelefone]}${nacional}`);
  }

  for (const candidato of candidatos) {
    const ok = valido(candidato);
    if (ok) return ok;
  }
  return null;
}

/** `PhoneNormalizer::fromDddENumero`: DDD + número separados (padrão Hotmart BR). */
export function telefoneDeDddENumero(ddd: unknown, numero: unknown, regiao: string = "BR"): string | null {
  if (typeof numero !== "string" && typeof numero !== "number") return null;
  const n = String(numero).trim();
  if (n === "") return null;
  const d = typeof ddd === "string" || typeof ddd === "number" ? String(ddd).trim() : "";
  return telefoneE164(`${d} ${n}`.trim(), regiao);
}
