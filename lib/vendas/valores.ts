/**
 * Leitura de valores do payload das plataformas — porte de
 * `app/Support/MapaCampos.php` (extrair, parseValor) e dos `?? null` dos
 * adapters do integrador. Puro, sem servidor.
 */

const CHAVES_PROIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

/** O objeto, ou `{}` — `$x['a'] ?? []` dos adapters. */
export function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

/** Texto de um campo (string não vazia ou número), ou nulo. */
export function texto(valor: unknown): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/** `data_get` do Laravel: caminho com ponto, só propriedade própria, índice numérico em lista. */
export function lerCaminho(origem: unknown, caminho: string): unknown {
  let atual: unknown = origem;
  for (const parte of caminho.split(".")) {
    if (parte === "" || CHAVES_PROIBIDAS.has(parte)) return undefined;
    if (Array.isArray(atual)) {
      if (!/^\d+$/.test(parte)) return undefined;
      atual = atual[Number(parte)];
    } else if (atual !== null && typeof atual === "object" && Object.hasOwn(atual, parte)) {
      atual = (atual as Record<string, unknown>)[parte];
    } else {
      return undefined;
    }
  }
  return atual;
}

/** `MapaCampos::extrair`: um caminho ou uma lista; o primeiro escalar não vazio, aparado. */
export function extrairTexto(
  payload: unknown,
  caminhos: string | readonly string[] | null | undefined,
): string | null {
  const lista = caminhos == null ? [] : typeof caminhos === "string" ? [caminhos] : caminhos;
  for (const caminho of lista) {
    if (typeof caminho !== "string" || caminho === "") continue;
    const valor = lerCaminho(payload, caminho);
    // `(string) false` do PHP é "" — falso não é valor.
    const escalar =
      typeof valor === "boolean" ? (valor ? "1" : "") : typeof valor === "string" || typeof valor === "number" ? String(valor) : null;
    if (escalar !== null && escalar.trim() !== "") return escalar.trim();
  }
  return null;
}

/** O mesmo CHECK de `contacts_email_format`: e-mail que o banco recusaria vira nulo. */
const FORMATO_DO_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailNormalizado(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const email = valor.trim().toLowerCase();
  return FORMATO_DO_EMAIL.test(email) ? email : null;
}

/** Reais (número ou texto numérico) → centavos: `(int) round($v * 100)`. */
export function reaisEmCentavos(valor: unknown): number | null {
  const numero =
    typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() !== "" ? Number(valor) : Number.NaN;
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

/** `MapaCampos::parseValor`: "197,90", "1.234,56", "R$ 197,90", "197.90", "19700" (centavos). */
export function textoEmCentavos(bruto: string, formato: "reais" | "centavos" = "reais"): number | null {
  let limpo = bruto.replace(/[^0-9,.-]/g, "");
  if (limpo === "" || limpo === "-") return null;
  const virgula = limpo.lastIndexOf(",");
  const ponto = limpo.lastIndexOf(".");
  limpo =
    virgula !== -1 && (ponto === -1 || virgula > ponto)
      ? limpo.replaceAll(".", "").replaceAll(",", ".")
      : limpo.replaceAll(",", "");
  const numero = Number(limpo);
  if (!Number.isFinite(numero)) return null;
  return formato === "centavos" ? Math.round(numero) : Math.round(numero * 100);
}

/** `{{venda.valor}}`: 29790 → "297,90" (`number_format($c / 100, 2, ',', '.')`). */
export function valorEmReais(centavos: number | null): string | null {
  if (centavos === null) return null;
  const absoluto = Math.abs(centavos);
  const inteiro = Math.floor(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${centavos < 0 ? "-" : ""}${inteiro},${String(absoluto % 100).padStart(2, "0")}`;
}

/** `Str::slug($s, '_')`: sem acento, minúsculo, o resto vira `_`. */
export function slug(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** `(bool) $v` do PHP: "" e "0" são falsos, "false" é verdadeiro. */
export function verdadeiroDoPhp(valor: unknown): boolean {
  if (typeof valor === "string") return valor !== "" && valor !== "0";
  if (typeof valor === "number") return valor !== 0;
  if (valor && typeof valor === "object") return Object.keys(valor).length > 0;
  return Boolean(valor);
}
