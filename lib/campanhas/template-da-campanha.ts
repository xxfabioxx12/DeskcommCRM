/**
 * A CAMPANHA POR TEMPLATE — as regras puras, as MESMAS na tela e no servidor.
 *
 * ═══ Quem decide se o número exige template ═══
 *
 * A capacidade do canal (`capabilitiesOf(provider).requiresTemplates`), nunca o
 * nome dele — invariante 1 de `docs/doctrine/restricao-de-canal.md`. Um canal
 * novo que exija template entra nesta tela sem tocar numa linha daqui.
 *
 * ═══ Quais variáveis existem ═══
 *
 * As do CONTRATO derivado da definição (`deriveTemplateContract`), chaveadas por
 * `slotKey` — a mesma chave que o montador do envio usa. Ninguém digita
 * quantidade de parâmetro.
 *
 * ═══ Duas passadas, como o texto ═══
 *
 * Na preparação cada expressão é renderizada SEM instante (nome e campos
 * congelados, valor blindado, `{{saudacao}}` literal); no envio, de novo COM
 * instante (`finalizarValores`). Ver o cabeçalho de `renderizador.ts`.
 */
import { capabilitiesOf, type ChannelProvider } from "@/lib/channels/capabilities";
import { slotKey } from "@/lib/channels/meta/build-components";
import { describeAddress, type TemplateContract } from "@/lib/channels/meta/template-contract";

import { renderizar, type ValoresDoDestinatario } from "./renderizador";

/** `true`/`false` pela capacidade; `null` quando o provider não é canal de mensagem conhecido. */
export function canalExigeTemplate(provider: string | null | undefined): boolean | null {
  if (!provider) return null;
  try {
    return capabilitiesOf(provider as ChannelProvider).requiresTemplates;
  } catch {
    return null;
  }
}

/** O intervalo que a PLATAFORMA impõe entre envios (`minIntervalMs`). `null` = não impõe. */
export function intervaloMinimoDoCanal(provider: string | null | undefined): number | null {
  if (!provider) return null;
  try {
    return capabilitiesOf(provider as ChannelProvider).minIntervalMs;
  } catch {
    return null;
  }
}

/** Um slot como a tela e o servidor o enxergam — o mesmo shape de `TemplateSlotView`. */
export interface SlotDoModelo {
  key: string;
  /** A chave em `template_values` e em `template_slot_map` (`slotKey`). */
  valueKey: string;
  expects: string;
  /** Rótulo humano do endereço ("corpo", "cabeçalho", "botão 1 (url)"). */
  onde: string;
}

export function slotsDoContrato(contrato: TemplateContract): SlotDoModelo[] {
  return contrato.slots.map((s) => ({
    key: s.key,
    valueKey: slotKey(s.address, s.key),
    expects: s.expects,
    onde: describeAddress(s.address),
  }));
}

/** O que a campanha preenche com o mapa: tudo texto. */
const PREENCHIVEIS = new Set(["text", "url_suffix", "coupon_code"]);
/** O que vem do link salvo no modelo (`meta_templates.saved_values`, migration 0382). */
const DE_MIDIA = new Set(["image", "video", "document"]);

export const MOTIVOS_DE_MODELO_INUTILIZAVEL = ["midia_sem_link", "tipo_nao_suportado"] as const;

export type MotivoDeModeloInutilizavel = (typeof MOTIVOS_DE_MODELO_INUTILIZAVEL)[number];

/** Por que um template aprovado aparece DESABILITADO no seletor da campanha. */
export const TEXTO_DO_MODELO_INUTILIZAVEL: Record<MotivoDeModeloInutilizavel, string> = {
  midia_sem_link: "Cabeçalho com imagem, vídeo ou documento sem link salvo",
  tipo_nao_suportado: "Variável de data ou valor em dinheiro",
};

export type AvaliacaoDoModelo =
  | { usavel: true; preencher: SlotDoModelo[]; midia: SlotDoModelo[] }
  | { usavel: false; motivo: MotivoDeModeloInutilizavel; slot: SlotDoModelo };

/**
 * A campanha consegue preencher este template? `currency` e `date_time` ficam
 * fora porque o montador do envio ainda lança para eles (`build-components.ts`).
 */
export function avaliarModeloParaCampanha(
  slots: readonly SlotDoModelo[],
  salvos: Readonly<Record<string, string>>,
): AvaliacaoDoModelo {
  const preencher: SlotDoModelo[] = [];
  const midia: SlotDoModelo[] = [];
  for (const slot of slots) {
    if (PREENCHIVEIS.has(slot.expects)) {
      preencher.push(slot);
      continue;
    }
    if (DE_MIDIA.has(slot.expects)) {
      if ((salvos[slot.valueKey] ?? "").trim() === "") return { usavel: false, motivo: "midia_sem_link", slot };
      midia.push(slot);
      continue;
    }
    return { usavel: false, motivo: "tipo_nao_suportado", slot };
  }
  return { usavel: true, preencher, midia };
}

export interface FalhaDoMapa {
  tipo: "faltando" | "sobrando";
  chaves: string[];
}

/** Todo slot preenchível tem expressão, e o mapa não tem chave que o template não tem. */
export function conferirMapaDeSlots(
  preencher: readonly SlotDoModelo[],
  mapa: Readonly<Record<string, string>>,
): FalhaDoMapa | null {
  const faltando = preencher.filter((s) => (mapa[s.valueKey] ?? "").trim() === "").map((s) => s.valueKey);
  if (faltando.length > 0) return { tipo: "faltando", chaves: faltando };
  const esperadas = new Set(preencher.map((s) => s.valueKey));
  const sobrando = Object.keys(mapa).filter((chave) => !esperadas.has(chave));
  if (sobrando.length > 0) return { tipo: "sobrando", chaves: sobrando };
  return null;
}

/** O mapa como o banco guarda: só texto, aparado, sem expressão vazia. Lê jsonb sem confiar no shape. */
export function limparMapaDeSlots(mapa: unknown): Record<string, string> {
  if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) return {};
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(mapa as Record<string, unknown>)) {
    if (typeof valor !== "string") continue;
    const limpo = valor.trim();
    if (limpo !== "") saida[chave] = limpo;
  }
  return saida;
}

/** As expressões juntas — para `camposUsadosNoTexto` decidir se busca `custom_fields`. */
export function textoDasExpressoes(mapa: Readonly<Record<string, string>>): string {
  return Object.values(mapa).join("\n");
}

/**
 * Um parâmetro de texto numa linha só. A plataforma recusa parâmetro com quebra
 * de linha, tabulação ou espaços seguidos — e campo personalizado de endereço ou
 * observação costuma ter os três. Sem isto, a recusa vinha para TODA a lista.
 */
export function normalizarValorDoSlot(valor: string): string {
  return valor.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

export interface SlotsResolvidos {
  valores: Record<string, string>;
  /** Variáveis sem valor (ou a chave do slot que ficou vazio). Vazio = pode enviar. */
  faltando: string[];
}

export function resolverSlots(
  mapa: Readonly<Record<string, string>>,
  valores: ValoresDoDestinatario,
  quando?: { agora: Date; fuso: string },
): SlotsResolvidos {
  const saida: Record<string, string> = {};
  const faltando = new Set<string>();
  for (const [chave, expressao] of Object.entries(mapa)) {
    const r = renderizar(expressao, valores, quando);
    const valor = normalizarValorDoSlot(r.texto);
    if (r.faltando.length > 0) {
      for (const variavel of r.faltando) faltando.add(variavel);
      continue;
    }
    if (valor === "") {
      faltando.add(chave);
      continue;
    }
    saida[chave] = valor;
  }
  return { valores: saida, faltando: [...faltando] };
}

/** A segunda passada, no envio: resolve `{{saudacao}}` no fuso do número e tira a blindagem. */
export function finalizarValores(
  preparados: Readonly<Record<string, string>>,
  nome: string | null,
  quando: { agora: Date; fuso: string },
): SlotsResolvidos {
  return resolverSlots(preparados, { nome }, quando);
}

/** `campaign_recipients.variables.template_values`, lido sem confiar no shape do jsonb. */
export function lerValoresPreparados(variables: unknown): Record<string, string> {
  if (!variables || typeof variables !== "object") return {};
  const bruto = (variables as Record<string, unknown>).template_values;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor === "string") saida[chave] = valor;
  }
  return saida;
}

/** A categoria da plataforma, como o operador a chama. */
export const CATEGORIA_DO_MODELO: Record<"MARKETING" | "UTILITY" | "AUTHENTICATION", string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

export function ehCategoriaConhecida(
  categoria: string | null | undefined,
): categoria is keyof typeof CATEGORIA_DO_MODELO {
  return categoria === "MARKETING" || categoria === "UTILITY" || categoria === "AUTHENTICATION";
}

/**
 * O começo do corpo do template, numa linha — o seletor mostra o TEXTO, não só o
 * nome técnico (é o texto que o operador precisa para escolher).
 */
export function resumoDoCorpo(components: unknown, max = 60): string {
  if (!Array.isArray(components)) return "";
  const corpo = (components as Array<Record<string, unknown>>).find(
    (c) => String(c.type ?? "").toUpperCase() === "BODY",
  );
  const texto = typeof corpo?.text === "string" ? corpo.text.replace(/\s+/g, " ").trim() : "";
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/** O template que o operador escolheu, com o carimbo do contrato DAQUELE momento. */
export interface ModeloEscolhido {
  name: string;
  language: string;
  contractHash: string;
}

/** O estado da seção "Mensagem" das telas de criar e editar. */
export interface MensagemDoFormulario {
  texto: string;
  modelo: ModeloEscolhido | null;
  slotMap: Record<string, string>;
}

export interface PayloadDaMensagem {
  message_mode: "text" | "template";
  message_body: string | null;
  template_name: string | null;
  template_language: string | null;
  template_contract_hash: string | null;
  template_slot_map: Record<string, string>;
}

/** O que a tela manda para POST/PATCH. `exigeTemplate` vem de `canalExigeTemplate`. */
export function payloadDaMensagem(m: MensagemDoFormulario, exigeTemplate: boolean | null): PayloadDaMensagem {
  if (!exigeTemplate) {
    return {
      message_mode: "text",
      message_body: m.texto.trim(),
      template_name: null,
      template_language: null,
      template_contract_hash: null,
      template_slot_map: {},
    };
  }
  return {
    message_mode: "template",
    message_body: null,
    template_name: m.modelo?.name ?? null,
    template_language: m.modelo?.language ?? null,
    template_contract_hash: m.modelo?.contractHash ?? null,
    template_slot_map: limparMapaDeSlots(m.slotMap),
  };
}

/** Dá para salvar? `preencher = null` no oficial = template não escolhido, inutilizável ou desatualizado. */
export function mensagemPronta(
  m: MensagemDoFormulario,
  exigeTemplate: boolean | null,
  preencher: readonly SlotDoModelo[] | null,
): boolean {
  if (!exigeTemplate) return m.texto.trim() !== "";
  if (!m.modelo || !preencher) return false;
  return conferirMapaDeSlots(preencher, limparMapaDeSlots(m.slotMap)) === null;
}
