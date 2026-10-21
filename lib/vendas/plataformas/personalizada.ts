import type { MapaDaPersonalizada } from "../config";
import type { VendaTraduzida } from "../eventos";
import { telefoneE164 } from "../telefone";
import { emailNormalizado, extrairTexto, slug, textoEmCentavos } from "../valores";
import { sha256, type EntregaDaVenda, type Identificacao } from "./tipos";

type Caminhos = string | readonly string[] | undefined;

function caminhoDoEvento(mapa: MapaDaPersonalizada): string | undefined {
  return mapa.evento && "path" in mapa.evento ? mapa.evento.path : undefined;
}

/** `CustomWebhookController::ehTeste`: qualquer valor, menos 0/false/no/nao/não. */
function ehTeste(valor: string | null): boolean {
  if (valor === null) return false;
  return !["0", "false", "no", "nao", "não"].includes(valor.toLowerCase());
}

export function identificarPersonalizada(e: EntregaDaVenda): Identificacao {
  const mapa: MapaDaPersonalizada = e.config.mapa ?? {};
  return {
    chave: (extrairTexto(e.payload, mapa.id_evento as Caminhos) ?? sha256(e.corpo)).slice(0, 128),
    eventoOriginal: (extrairTexto(e.payload, caminhoDoEvento(mapa)) ?? "personalizado").slice(0, 100),
    teste: ehTeste(extrairTexto(e.payload, mapa.teste as Caminhos)),
  };
}

/** `MapaCampos::resolverEvento`: fixo, ou caminho traduzido; sem tradução, `custom.<slug>`. */
export function resolverEvento(payload: unknown, conf: MapaDaPersonalizada["evento"]): string | null {
  if (!conf) return null;
  if ("fixo" in conf) return conf.fixo;
  const bruto = extrairTexto(payload, conf.path);
  if (bruto === null) return null;
  if (conf.map && Object.hasOwn(conf.map, bruto)) return conf.map[bruto] ?? null;
  // Ponto, hífen e barra viram separador antes do slug: "lesson.completed" → "lesson_completed".
  const s = slug(bruto.replace(/[./-]/g, " "));
  return s === "" ? null : `custom.${s}`;
}

function valorDoMapa(payload: unknown, conf: MapaDaPersonalizada["valor"]): number | null {
  if (conf === undefined) return null;
  const objeto = typeof conf === "object" && !Array.isArray(conf) ? (conf as { path: Caminhos; formato?: "reais" | "centavos" }) : null;
  const bruto = extrairTexto(payload, objeto ? objeto.path : (conf as Caminhos));
  return bruto === null ? null : textoEmCentavos(bruto, objeto?.formato ?? "reais");
}

function fixoOuCaminho(payload: unknown, conf: MapaDaPersonalizada["moeda"]): string | null {
  if (conf && typeof conf === "object" && !Array.isArray(conf)) return (conf as { fixo: string }).fixo;
  return extrairTexto(payload, conf as Caminhos);
}

function extras(payload: unknown, conf: MapaDaPersonalizada["extras"]): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [nome, caminho] of Object.entries(conf ?? {})) {
    const valor = extrairTexto(payload, caminho);
    if (valor !== null) saida[nome] = valor;
  }
  return saida;
}

export function traduzirPersonalizada(e: EntregaDaVenda, chave: string): VendaTraduzida | null {
  const mapa = e.config.mapa;
  if (!mapa || Object.keys(mapa).length === 0) return null; // sem mapa: quem chama orienta o operador
  const evento = resolverEvento(e.payload, mapa.evento);
  if (evento === null) return null;
  const regiao = e.config.telefone_regiao ?? "BR";
  const entidade = extrairTexto(e.payload, (mapa.entity ?? mapa.id_evento) as Caminhos);
  return {
    evento,
    entidade: `custom:${entidade ?? chave}`,
    orderBump: false,
    nome: extrairTexto(e.payload, mapa.nome as Caminhos),
    email: emailNormalizado(extrairTexto(e.payload, mapa.email as Caminhos)),
    telefone: telefoneE164(extrairTexto(e.payload, mapa.telefone as Caminhos), regiao),
    produtoId: extrairTexto(e.payload, mapa.produto_id as Caminhos),
    produto: extrairTexto(e.payload, mapa.produto_nome as Caminhos),
    ofertaCodigo: null,
    ofertaNome: null,
    valorCentavos: valorDoMapa(e.payload, mapa.valor),
    moeda: fixoOuCaminho(e.payload, mapa.moeda) ?? "BRL",
    checkoutUrl: extrairTexto(e.payload, mapa.checkout_url as Caminhos),
    pedido: extrairTexto(e.payload, (mapa.id_evento ?? mapa.entity) as Caminhos),
    extras: extras(e.payload, mapa.extras),
  };
}
