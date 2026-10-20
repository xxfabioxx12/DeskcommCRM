/**
 * O NÚMERO ACEITA ESTA MENSAGEM? — conferido no SERVIDOR, não só na tela.
 *
 * Roda ao salvar (POST/PATCH), ao preparar, iniciar, agendar e testar. A rodada
 * confere de novo antes de cada envio (`envio-por-template.ts`), porque a
 * definição pode ser pausada ou mudar na plataforma a qualquer momento.
 *
 * ═══ As regras ═══
 *
 *   1. A exigência vem da CAPACIDADE do canal (`canalExigeTemplate`), nunca do
 *      nome do provider — `pnpm lint:channels`.
 *   2. Número que exige template recusa texto livre; número que não exige recusa
 *      template. Todos os números do rodízio têm a mesma exigência.
 *   3. Em template, CADA número acha a definição no espelho (`linhaDoEspelho`:
 *      a linha da conexão ou, no canal oficial, a da conta), APROVADA e com o
 *      MESMO carimbo de contrato gravado na escolha (`bindingState`).
 *   4. A campanha só preenche texto (corpo/cabeçalho), sufixo de URL e cupom;
 *      mídia só com link salvo; valor e data ficam fora.
 *   5. Todo slot preenchível tem expressão, e nenhuma expressão sobra.
 *
 * `avaliarConteudoDaCampanha` é pura (o teste a exercita inteira); a função
 * assíncrona só busca as linhas e a delega.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiErrorCode } from "@/lib/api/errors";
import { linhaDoEspelho } from "@/lib/channels/linha-do-espelho";
import { bindingState, type BindingState } from "@/lib/channels/meta/template-binding";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";
import { mesclarValoresSalvos } from "@/lib/channels/meta/valores-salvos";

import {
  avaliarModeloParaCampanha,
  canalExigeTemplate,
  conferirMapaDeSlots,
  limparMapaDeSlots,
  slotsDoContrato,
} from "./template-da-campanha";
import { renderizar, temChaveSolta } from "./renderizador";
import {
  TEXTO_DA_FALHA_DA_CAMPANHA,
  type FalhaDeTemplateDaCampanha,
  type ModoDaMensagem,
} from "./tipos";

export interface ConteudoDaCampanha {
  messageMode: ModoDaMensagem;
  templateName: string | null;
  templateLanguage: string | null;
  templateContractHash: string | null;
  slotMap: Readonly<Record<string, string>>;
}

/** O conteúdo de toda campanha que já existia: texto, sem template. */
export const CONTEUDO_EM_TEXTO: ConteudoDaCampanha = {
  messageMode: "text",
  templateName: null,
  templateLanguage: null,
  templateContractHash: null,
  slotMap: {},
};

/** O que POST/PATCH trazem (já validado pelo zod). */
export interface EntradaDeConteudo {
  message_mode?: ModoDaMensagem;
  template_name?: string | null;
  template_language?: string | null;
  template_contract_hash?: string | null;
  template_slot_map?: Record<string, string>;
}

/** A entrada sobre o conteúdo atual. Campo ausente = mantém; texto = sem template. */
export function conteudoMesclado(atual: ConteudoDaCampanha, entrada: EntradaDeConteudo): ConteudoDaCampanha {
  const modo = entrada.message_mode ?? atual.messageMode;
  if (modo === "text") return CONTEUDO_EM_TEXTO;
  return {
    messageMode: "template",
    templateName: entrada.template_name !== undefined ? entrada.template_name : atual.templateName,
    templateLanguage: entrada.template_language !== undefined ? entrada.template_language : atual.templateLanguage,
    templateContractHash:
      entrada.template_contract_hash !== undefined ? entrada.template_contract_hash : atual.templateContractHash,
    slotMap: entrada.template_slot_map !== undefined ? limparMapaDeSlots(entrada.template_slot_map) : atual.slotMap,
  };
}

/** A linha de `campaigns` como conteúdo. Coluna ausente (base anterior à 9001) = texto. */
export function conteudoDaLinha(c: {
  message_mode?: string | null;
  template_name?: string | null;
  template_language?: string | null;
  template_contract_hash?: string | null;
  template_slot_map?: unknown;
}): ConteudoDaCampanha {
  if (c.message_mode !== "template") return CONTEUDO_EM_TEXTO;
  return {
    messageMode: "template",
    templateName: c.template_name ?? null,
    templateLanguage: c.template_language ?? null,
    templateContractHash: c.template_contract_hash ?? null,
    slotMap: limparMapaDeSlots(c.template_slot_map),
  };
}

function mapaCanonico(mapa: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(mapa).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Mudou o que cada pessoa recebe? É o que sobe `content_version` (além do `message_body`). */
export function conteudoDoTemplateMudou(antes: ConteudoDaCampanha, depois: ConteudoDaCampanha): boolean {
  return (
    antes.messageMode !== depois.messageMode ||
    antes.templateName !== depois.templateName ||
    antes.templateLanguage !== depois.templateLanguage ||
    antes.templateContractHash !== depois.templateContractHash ||
    mapaCanonico(antes.slotMap) !== mapaCanonico(depois.slotMap)
  );
}

/** As colunas da migration 9001, prontas para insert/update. */
export function colunasDoConteudo(c: ConteudoDaCampanha): {
  message_mode: ModoDaMensagem;
  template_name: string | null;
  template_language: string | null;
  template_contract_hash: string | null;
  template_slot_map: Record<string, string>;
} {
  return {
    message_mode: c.messageMode,
    template_name: c.templateName,
    template_language: c.templateLanguage,
    template_contract_hash: c.templateContractHash,
    template_slot_map: { ...c.slotMap },
  };
}

/** A linha de `meta_templates` que interessa à campanha. */
export interface LinhaDoModelo {
  name: string;
  language: string;
  status: string;
  contract_hash: string;
  components: unknown;
  parameter_format: string | null;
  saved_values: unknown;
}

export const COLUNAS_DO_MODELO = "name, language, status, contract_hash, components, parameter_format, saved_values";

/** O que a preparação e o teste precisam da definição conferida. */
export interface DefinicaoDaCampanha {
  name: string;
  language: string;
  parameterFormat: string;
  components: unknown;
  /** Links de mídia salvos no modelo, já filtrados pelo contrato de hoje. */
  salvos: Record<string, string>;
}

export type ConferenciaDoConteudo =
  | { ok: true; definicao: DefinicaoDaCampanha | null }
  | {
      ok: false;
      codigo: ApiErrorCode;
      mensagem: string;
      status: number;
      /** Presente quando a recusa é do vínculo com o template (vira `failure_code` na rodada). */
      falha?: FalhaDeTemplateDaCampanha;
    };

/** Frases da recusa. Espanhol no dicionário; a rota passa por `traduzir`. */
export const MENSAGENS_DA_CONFERENCIA = {
  exige_template:
    "Este número é oficial: para quem não falou com você nas últimas 24 horas, a Meta só entrega template aprovado. Escolha um template.",
  nao_usa_template: "Este número não trabalha com template aprovado: escreva a mensagem em texto.",
  numeros_misturados:
    "Todos os números da campanha precisam ser do mesmo tipo: todos oficiais (template) ou todos por QR Code (texto).",
  canal_desconhecido: "Escolha uma conexão de WhatsApp desta organização.",
  template_inexistente: "O template não existe mais neste número. Escolha outro template.",
  template_nao_aprovado: TEXTO_DA_FALHA_DA_CAMPANHA.template_nao_aprovado,
  template_mudou: TEXTO_DA_FALHA_DA_CAMPANHA.template_mudou,
  midia_sem_link:
    "Este template tem cabeçalho com imagem, vídeo ou documento sem link salvo. Salve o link na tela de Templates ou escolha outro.",
  tipo_nao_suportado:
    "Este template usa variável de data ou valor em dinheiro, que a campanha ainda não sabe preencher. Escolha outro.",
  variaveis_faltando: "Preencha todas as variáveis do template.",
  variaveis_sobrando: "O mapa de variáveis tem campos que este template não tem. Escolha o template de novo.",
  problema_em_numero_extra:
    "Um dos números extras da campanha tem este template com problema (link de mídia salvo ou variáveis diferentes). Confira o template em cada número.",
  variavel_desconhecida:
    "Há uma variável desconhecida no preenchimento do template. Use {{nome}}, {{primeiro_nome}}, {{saudacao}}, {{contato.campo}} ou {{lead.campo}}.",
  variavel_mal_escrita:
    "Há uma variável escrita errado no preenchimento do template. Use {{nome}}, {{primeiro_nome}}, {{saudacao}}, {{contato.campo}} ou {{lead.campo}}, sem espaço nem acento dentro das chaves.",
} as const;

function recusa(
  codigo: ApiErrorCode,
  mensagem: string,
  status: number,
  falha?: FalhaDeTemplateDaCampanha,
): ConferenciaDoConteudo {
  return falha ? { ok: false, codigo, mensagem, status, falha } : { ok: false, codigo, mensagem, status };
}

function recusaDoVinculo(estado: Exclude<BindingState, "ok">): ConferenciaDoConteudo {
  if (estado === "missing") {
    return recusa("campanha_template_invalido", MENSAGENS_DA_CONFERENCIA.template_inexistente, 422, "template_nao_aprovado");
  }
  if (estado === "not_approved") {
    return recusa("campanha_template_invalido", MENSAGENS_DA_CONFERENCIA.template_nao_aprovado, 422, "template_nao_aprovado");
  }
  return recusa("campanha_template_invalido", MENSAGENS_DA_CONFERENCIA.template_mudou, 422, "template_mudou");
}

/** A linha do espelho conferida contra o vínculo gravado na campanha. */
export type ConferenciaDaLinha =
  | {
      ok: true;
      linha: LinhaDoModelo;
      contrato: ReturnType<typeof deriveTemplateContract>;
      /** Links de mídia salvos no modelo, já filtrados pelo contrato de hoje. */
      salvos: Record<string, string>;
    }
  | { ok: false; estado: Exclude<BindingState, "ok"> };

/**
 * O vínculo de UM número: a linha existe, está APROVADA e tem o MESMO carimbo de
 * contrato gravado na escolha (`bindingState`)? Devolve o contrato e os links
 * salvos. É a única conferência do vínculo — a gravação, a preparação, o teste e
 * a rodada (`envio-por-template.ts`) passam por aqui.
 */
export function conferirLinhaDoModelo(
  vinculo: Pick<ConteudoDaCampanha, "templateName" | "templateLanguage" | "templateContractHash">,
  linha: LinhaDoModelo | null,
): ConferenciaDaLinha {
  const estado = bindingState(
    {
      name: vinculo.templateName ?? "",
      language: vinculo.templateLanguage ?? "",
      contractHash: vinculo.templateContractHash ?? "",
      values: {},
    },
    linha ? { name: linha.name, language: linha.language, contractHash: linha.contract_hash, status: linha.status } : null,
  );
  if (estado !== "ok") return { ok: false, estado };
  if (!linha) return { ok: false, estado: "missing" };
  const contrato = deriveTemplateContract({
    name: linha.name,
    language: linha.language,
    parameter_format: linha.parameter_format ?? undefined,
    components: linha.components as never,
  });
  const mescla = mesclarValoresSalvos(contrato, (linha.saved_values ?? {}) as Record<string, unknown>, {});
  return { ok: true, linha, contrato, salvos: mescla.ok ? mescla.valores : {} };
}

export function avaliarConteudoDaCampanha(
  conteudo: ConteudoDaCampanha,
  sessoes: ReadonlyArray<{ id: string; provider: string | null }>,
  linhas: ReadonlyMap<string, LinhaDoModelo | null>,
): ConferenciaDoConteudo {
  const exigencias = sessoes.map((s) => canalExigeTemplate(s.provider));
  if (exigencias.length === 0 || exigencias.some((e) => e === null)) {
    return recusa("campanha_canal_indisponivel", MENSAGENS_DA_CONFERENCIA.canal_desconhecido, 409);
  }
  const exige = exigencias[0] === true;
  if (exigencias.some((e) => e !== exige)) {
    return recusa("campanha_template_invalido", MENSAGENS_DA_CONFERENCIA.numeros_misturados, 422);
  }
  if (exige && conteudo.messageMode !== "template") {
    return recusa("campanha_exige_template", MENSAGENS_DA_CONFERENCIA.exige_template, 422);
  }
  if (!exige && conteudo.messageMode === "template") {
    return recusa("campanha_template_invalido", MENSAGENS_DA_CONFERENCIA.nao_usa_template, 422);
  }
  if (conteudo.messageMode === "text") return { ok: true, definicao: null };

  let principal: { linha: LinhaDoModelo; contrato: ReturnType<typeof deriveTemplateContract>; salvos: Record<string, string> } | null =
    null;
  for (const sessao of sessoes) {
    // Cada número tem a SUA linha (parceiro: por conexão) e pode ter outro link de mídia salvo.
    const conferida = conferirLinhaDoModelo(conteudo, linhas.get(sessao.id) ?? null);
    if (!conferida.ok) return recusaDoVinculo(conferida.estado);
    const { linha: atual, contrato, salvos } = conferida;
    const avaliacao = avaliarModeloParaCampanha(slotsDoContrato(contrato), salvos);
    const doExtra = principal !== null;
    if (!avaliacao.usavel) {
      return recusa(
        "campanha_template_invalido",
        doExtra ? MENSAGENS_DA_CONFERENCIA.problema_em_numero_extra : MENSAGENS_DA_CONFERENCIA[avaliacao.motivo],
        422,
      );
    }
    const mapa = conferirMapaDeSlots(avaliacao.preencher, conteudo.slotMap);
    if (mapa) {
      return recusa(
        "campanha_template_invalido",
        doExtra
          ? MENSAGENS_DA_CONFERENCIA.problema_em_numero_extra
          : mapa.tipo === "faltando"
            ? MENSAGENS_DA_CONFERENCIA.variaveis_faltando
            : MENSAGENS_DA_CONFERENCIA.variaveis_sobrando,
        422,
      );
    }
    principal ??= { linha: atual, contrato, salvos };
  }
  if (!principal) return recusaDoVinculo("missing");
  const { linha: linhaPrincipal, contrato, salvos } = principal;

  // P17: variável que o renderizador não conhece sairia literal para o cliente.
  // Chave que sobra depois dos tokens válidos ({{nome completo}}) também sairia literal.
  for (const expressao of Object.values(conteudo.slotMap)) {
    if (temChaveSolta(expressao)) {
      return recusa("campanha_template_invalido", MENSAGENS_DA_CONFERENCIA.variavel_mal_escrita, 422);
    }
    if (renderizar(expressao, { nome: "x" }).desconhecidas.length > 0) {
      return recusa("campanha_template_invalido", MENSAGENS_DA_CONFERENCIA.variavel_desconhecida, 422);
    }
  }
  return {
    ok: true,
    definicao: {
      name: linhaPrincipal.name,
      language: linhaPrincipal.language,
      parameterFormat: contrato.parameterFormat,
      components: linhaPrincipal.components,
      salvos,
    },
  };
}

/**
 * Busca os números e as linhas do espelho, e delega a decisão. `channelSessionIds[0]`
 * é o número principal. Lança em erro de banco (quem chama decide o 500).
 */
export async function conferirConteudoDaCampanha(
  admin: SupabaseClient,
  entrada: { organizationId: string; channelSessionIds: readonly string[]; conteudo: ConteudoDaCampanha },
): Promise<ConferenciaDoConteudo> {
  const ids = [...new Set(entrada.channelSessionIds)];
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, provider")
    .eq("organization_id", entrada.organizationId)
    .is("archived_at", null)
    .in("id", ids);
  if (error) throw new Error(`conferência do conteúdo: conexões — ${error.message}`);
  const porId = new Map(((data ?? []) as Array<{ id: string; provider: string | null }>).map((s) => [s.id, s]));
  const principal = ids[0] ? porId.get(ids[0]) : undefined;
  if (!principal) return avaliarConteudoDaCampanha(entrada.conteudo, [], new Map());
  // Extra que não é desta organização fica fora daqui: `gravarPool` já o recusa.
  const sessoes = ids.map((id) => porId.get(id)).filter((s): s is { id: string; provider: string | null } => !!s);

  const linhas = new Map<string, LinhaDoModelo | null>();
  const { templateName, templateLanguage } = entrada.conteudo;
  if (entrada.conteudo.messageMode === "template" && templateName && templateLanguage) {
    for (const sessao of sessoes) {
      const r = await linhaDoEspelho<LinhaDoModelo>(admin, COLUNAS_DO_MODELO, {
        organizationId: entrada.organizationId,
        name: templateName,
        language: templateLanguage,
        channelSessionId: sessao.id,
      });
      if (r.error) throw new Error(`conferência do conteúdo: template — ${r.error.message}`);
      linhas.set(sessao.id, r.data);
    }
  }
  return avaliarConteudoDaCampanha(entrada.conteudo, sessoes, linhas);
}
