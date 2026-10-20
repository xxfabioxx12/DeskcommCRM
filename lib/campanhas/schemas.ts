/**
 * O que a API aceita de fora. Zod em todo input externo, como manda a doutrina —
 * e nada aqui aceita `organization_id`: a organização vem do `requireRole()`,
 * nunca do corpo.
 */
import { z } from "zod";

import { filtroDeAudienciaSchema } from "./audiencia";
import { MODOS_DA_MENSAGEM } from "./tipos";

/**
 * O ritmo próprio. Todos opcionais e anuláveis: `null` devolve a decisão ao
 * canal, que é o default de quem nunca abriu esta seção.
 *
 * As faixas são as do CHECK da migration 0375 — validação de entrada do
 * operador, não default de comportamento (os números de pacing são fonte única
 * em `lib/agent-engine/pacing/defaults.ts`).
 */
export const ritmoSchema = z.object({
  intervalo_segundos: z.number().int().min(1).max(86_400).nullable().optional(),
  janela_inicio_hora: z.number().int().min(0).max(23).nullable().optional(),
  janela_fim_hora: z.number().int().min(1).max(24).nullable().optional(),
  teto_diario: z.number().int().min(1).max(10_000).nullable().optional(),
  teto_horario: z.number().int().min(1).max(10_000).nullable().optional(),
});

/**
 * O mapa slot → expressão de uma campanha por template (migration 0704).
 *
 * A chave é a de `slotKey` (`1`, `nome`, `header:1`, `button0:1`,
 * `card0:header:1`) — só palavra e dois-pontos. O teto de 50 é folga sobre o
 * maior template real (corpo + cabeçalho + botões + carrossel de 10 cards); ele
 * existe para um corpo malformado não virar um jsonb de megabytes.
 */
export const mapaDeSlotsSchema = z
  .record(z.string().regex(/^[A-Za-z0-9_:]{1,80}$/), z.string().max(1024))
  .refine((mapa) => Object.keys(mapa).length <= 50, {
    message: "Um template tem no máximo 50 variáveis.",
  });

/** O template escolhido. Coerência (template × texto) é refine de `criar` e conferência da rota. */
const conteudoDoTemplate = {
  message_mode: z.enum(MODOS_DA_MENSAGEM).optional(),
  template_name: z.string().trim().min(1).max(512).nullable().optional(),
  template_language: z.string().trim().min(2).max(16).nullable().optional(),
  template_contract_hash: z.string().trim().min(1).max(128).nullable().optional(),
  template_slot_map: mapaDeSlotsSchema.optional(),
};

const baseDaCampanha = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  channel_session_id: z.string().uuid(),
  message_body: z.string().trim().max(4096).nullable().optional(),
  base_legal: z.enum(["consent", "legitimate_interest"]),
  lia_ref: z.string().trim().max(120).nullable().optional(),
  audience_filter: filtroDeAudienciaSchema.optional(),
  /**
   * Os números EXTRAS do rodízio (migration 0377). O principal continua em
   * `channel_session_id`; estes entram junto. Vazio = campanha de um número só,
   * que é como toda campanha existente se comporta.
   */
  channel_session_ids: z.array(z.string().uuid()).max(10).optional(),
  /**
   * Onde o card de quem responde nasce, e quem atende (migration 0378).
   * `null` devolve a decisão ao número, que é o comportamento de sempre.
   */
  pipeline_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
  ...conteudoDoTemplate,
};

export const criarCampanhaSchema = z
  .object({ ...baseDaCampanha })
  .merge(ritmoSchema)
  .refine(
    (c) => c.base_legal !== "legitimate_interest" || (c.lia_ref ?? "").trim() !== "",
    {
      message:
        "Interesse legítimo exige a referência da avaliação (LIA) — é ela que responde a quem " +
        "perguntar com base em quê recebeu a mensagem.",
      path: ["lia_ref"],
    },
  )
  .refine((c) => c.stage_id == null || c.pipeline_id != null, {
    message: "Escolha o funil antes da etapa — etapa sem funil seria um card sem coluna.",
    path: ["stage_id"],
  })
  .refine(
    (c) =>
      c.janela_inicio_hora == null ||
      c.janela_fim_hora == null ||
      c.janela_fim_hora > c.janela_inicio_hora,
    { message: "A janela precisa terminar depois de começar.", path: ["janela_fim_hora"] },
  )
  .refine(
    (c) =>
      (c.message_mode ?? "text") === "text"
        ? c.template_name == null && c.template_language == null && c.template_contract_hash == null
        : !!c.template_name && !!c.template_language && !!c.template_contract_hash,
    {
      message:
        "Template exige nome, idioma e o carimbo do contrato; mensagem em texto não leva template.",
      path: ["template_name"],
    },
  );

/** Edição de rascunho: tudo opcional, e a mesma checagem de base legal na rota. */
export const editarCampanhaSchema = z
  .object({
    name: baseDaCampanha.name.optional(),
    description: baseDaCampanha.description,
    channel_session_id: baseDaCampanha.channel_session_id.optional(),
    message_body: baseDaCampanha.message_body,
    base_legal: baseDaCampanha.base_legal.optional(),
    lia_ref: baseDaCampanha.lia_ref,
    audience_filter: filtroDeAudienciaSchema.optional(),
    channel_session_ids: baseDaCampanha.channel_session_ids,
    pipeline_id: baseDaCampanha.pipeline_id,
    stage_id: baseDaCampanha.stage_id,
    agent_id: baseDaCampanha.agent_id,
    message_mode: conteudoDoTemplate.message_mode,
    template_name: conteudoDoTemplate.template_name,
    template_language: conteudoDoTemplate.template_language,
    template_contract_hash: conteudoDoTemplate.template_contract_hash,
    template_slot_map: conteudoDoTemplate.template_slot_map,
  })
  .merge(ritmoSchema);

export const previaSchema = z.object({
  audience_filter: filtroDeAudienciaSchema,
  message_body: z.string().max(4096).default(""),
  campaign_id: z.string().uuid().optional(),
  /** Em `template`, a prévia resolve o mapa por pessoa em vez do texto. */
  message_mode: z.enum(MODOS_DA_MENSAGEM).default("text"),
  template_slot_map: mapaDeSlotsSchema.optional(),
});

export const criarTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4096),
});

export const editarTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(4096).optional(),
});

/**
 * O telefone entra CRU e sai em hash — a normalização e o hash moram em
 * `lib/campanhas/exclusoes.ts`, para o mesmo cálculo valer na gravação e na
 * consulta. Aqui só se exige que algo tenha sido digitado.
 */
export const criarExclusaoSchema = z.object({
  address: z.string().trim().min(8).max(32),
  reason: z.string().trim().max(240).nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
});

export const agendarSchema = z.object({ scheduled_at: z.string().datetime() });
export const testarSchema = z.object({ contact_id: z.string().uuid() });

export const listarCampanhasSchema = z.object({
  status: z.string().trim().max(20).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const listarDestinatariosSchema = z.object({
  status: z.string().trim().max(20).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Cursor opaco `created_at|id`, o mesmo formato de `lib/schemas/lead-captures.ts`.
 * Sem HMAC, como os outros: ele só ordena, não autoriza — a organização vem do
 * papel conferido, e um cursor forjado não alcança linha de outro tenant.
 */
export function codificarCursor(c: { created_at: string; id: string }): string {
  return Buffer.from(`${c.created_at}|${c.id}`, "utf8").toString("base64url");
}

export function decodificarCursor(bruto: string): { created_at: string; id: string } | null {
  try {
    const [created_at, id] = Buffer.from(bruto, "base64url").toString("utf8").split("|");
    if (!created_at || !id) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}
