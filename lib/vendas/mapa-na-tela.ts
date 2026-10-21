/**
 * O mapa da conexão personalizada ↔ os campos da tela. Puro: a tela usa, o teste
 * prova a ida e volta. Linhas `valor=evento` e `nome=caminho` são o jeito mais
 * curto de editar as duas listas sem uma tabela dinâmica.
 */
import type { MapaDaPersonalizada } from "./config";

export const CAMPOS_SIMPLES_DO_MAPA = [
  "email",
  "telefone",
  "nome",
  "produto_id",
  "produto_nome",
  "valor",
  "id_evento",
  "teste",
  "checkout_url",
] as const;
export type CampoSimplesDoMapa = (typeof CAMPOS_SIMPLES_DO_MAPA)[number];

export const ROTULO_DO_CAMPO_DO_MAPA = {
  email: "Caminho do e-mail",
  telefone: "Caminho do telefone",
  nome: "Caminho do nome",
  produto_id: "Caminho do id do produto",
  produto_nome: "Caminho do nome do produto",
  valor: "Caminho do valor",
  id_evento: "Caminho do id do evento",
  teste: "Caminho da marca de teste",
  checkout_url: "Caminho do link do checkout",
} as const satisfies Record<CampoSimplesDoMapa, string>;

export interface CamposDoMapaNaTela {
  caminhos: Partial<Record<CampoSimplesDoMapa, string>>;
  eventoCaminho: string;
  eventoFixo: string;
  traducoes: string;
  formatoDoValor: "reais" | "centavos";
  extras: string;
}

export function linhasEmPares(texto: string): Record<string, string> {
  const pares: Record<string, string> = {};
  for (const linha of texto.split("\n")) {
    const igual = linha.indexOf("=");
    if (igual <= 0) continue;
    const chave = linha.slice(0, igual).trim();
    const valor = linha.slice(igual + 1).trim();
    if (chave && valor) pares[chave] = valor;
  }
  return pares;
}

function paresEmLinhas(pares: Record<string, unknown> | undefined): string {
  return Object.entries(pares ?? {})
    .map(
      ([chave, valor]) =>
        `${chave}=${Array.isArray(valor) ? String(valor[0] ?? "") : String(valor)}`,
    )
    .join("\n");
}

function primeiro(valor: unknown): string {
  return typeof valor === "string" ? valor : Array.isArray(valor) ? String(valor[0] ?? "") : "";
}

export function mapaDaTela(tela: CamposDoMapaNaTela): MapaDaPersonalizada {
  const mapa: Record<string, unknown> = {};
  if (tela.eventoFixo) {
    mapa.evento = { fixo: tela.eventoFixo };
  } else if (tela.eventoCaminho.trim()) {
    const traducoes = linhasEmPares(tela.traducoes);
    mapa.evento = {
      path: tela.eventoCaminho.trim(),
      ...(Object.keys(traducoes).length ? { map: traducoes } : {}),
    };
  }
  for (const campo of CAMPOS_SIMPLES_DO_MAPA) {
    const valor = tela.caminhos[campo]?.trim();
    if (!valor) continue;
    mapa[campo] = campo === "valor" ? { path: valor, formato: tela.formatoDoValor } : valor;
  }
  const extras = linhasEmPares(tela.extras);
  if (Object.keys(extras).length) mapa.extras = extras;
  return mapa as MapaDaPersonalizada;
}

export function telaDoMapa(mapa: MapaDaPersonalizada | undefined): CamposDoMapaNaTela {
  const m = (mapa ?? {}) as Record<string, unknown>;
  const evento = m.evento as
    { fixo?: string; path?: string; map?: Record<string, string> } | undefined;
  const valor = m.valor;
  const caminhos: Partial<Record<CampoSimplesDoMapa, string>> = {};
  for (const campo of CAMPOS_SIMPLES_DO_MAPA) {
    const bruto =
      campo === "valor" && valor && typeof valor === "object" && !Array.isArray(valor)
        ? (valor as { path: unknown }).path
        : m[campo];
    const lido = primeiro(bruto);
    if (lido) caminhos[campo] = lido;
  }
  return {
    caminhos,
    eventoCaminho: evento?.path ?? "",
    eventoFixo: evento?.fixo ?? "",
    traducoes: paresEmLinhas(evento?.map),
    formatoDoValor:
      valor &&
      typeof valor === "object" &&
      !Array.isArray(valor) &&
      (valor as { formato?: string }).formato === "centavos"
        ? "centavos"
        : "reais",
    extras: paresEmLinhas(m.extras as Record<string, unknown> | undefined),
  };
}
