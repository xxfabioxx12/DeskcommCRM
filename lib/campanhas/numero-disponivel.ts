/**
 * O ESTADO DE UM NÚMERO para o rodízio — a leitura que a rodada da campanha faz
 * de cada número do pool: no ar, folga no teto do dia, o que o pacing deixa
 * agora (aquecimento, anti-ban, janela) e o intervalo da plataforma. Extraída de
 * `rodada.ts` para a entrada das vendas (Parte 2 §4) escolher o número de saída
 * com `escolherNumero` sobre a MESMA leitura — uma régua só.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decidePacing, warmupCapFor } from "@/lib/agent-engine/pacing/engine";
import { loadChannelKnobs, loadPacingState } from "@/lib/agent-engine/pacing/store";
import type { Queryable } from "@/lib/agent-engine/queue/queue";

import type { NumeroDisponivel } from "./rodizio";
import { intervaloDoCanalCumprido } from "./ritmo";
import { canalExigeTemplate, intervaloMinimoDoCanal } from "./template-da-campanha";

export type KnobsDoNumero = Awaited<ReturnType<typeof loadChannelKnobs>>;

export interface LeituraDoNumero {
  numero: NumeroDisponivel;
  knobs: KnobsDoNumero;
  exigeTemplate: boolean;
  /**
   * O número em aquecimento já mandou hoje o teto do degrau da idade dele
   * (`warmupCapFor`, a mesma regra do `decidePacing`). À parte do `podeAgora`
   * porque o pacing olha a janela ANTES e, fora dela, esconde o aquecimento.
   */
  aquecimentoEstourado: boolean;
}

const DIA_MS = 86_400_000;

/** `null` = fora do rodízio: número fora do ar (mandar por ele fabricaria mensagem presa) ou de outra empresa. */
export async function lerNumero(
  admin: SupabaseClient,
  pool: Queryable,
  organizationId: string,
  sessionId: string,
  agora: Date,
  knobsJaLidos?: KnobsDoNumero,
): Promise<LeituraDoNumero | null> {
  const k = knobsJaLidos ?? (await loadChannelKnobs(pool, organizationId, sessionId));
  const { data: canal } = await admin
    .from("channel_sessions")
    .select("daily_message_limit, status, provider")
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  const linha = canal as { daily_message_limit: number | null; status: string; provider: string | null } | null;
  if (!linha || linha.status !== "WORKING") return null;

  const estado = await loadPacingState(pool, organizationId, sessionId, {
    now: agora,
    timezone: k.knobs.timezone,
    numberActivatedAt: k.numberActivatedAt,
  });
  const decisao = decidePacing({ now: agora, knobs: k.knobs, state: estado, crmDailyLimit: linha.daily_message_limit ?? null });
  // Idade como no `decidePacing`: sem ativação = 0 dia; ativação no futuro = 0 (falha fechado).
  const idadeDias = estado.numberActivatedAt
    ? Math.max(0, Math.floor((agora.getTime() - estado.numberActivatedAt.getTime()) / DIA_MS))
    : 0;
  // `loadChannelKnobs` sempre preenche os degraus; o `?? []` só protege dublês de knobs sem eles.
  const tetoDoAquecimento = warmupCapFor(idadeDias, k.knobs.warmupDailyCaps ?? []);
  return {
    knobs: k,
    exigeTemplate: canalExigeTemplate(linha.provider) === true,
    aquecimentoEstourado: tetoDoAquecimento !== null && estado.sentToday >= tetoDoAquecimento,
    numero: {
      sessionId,
      folgaDoDia: linha.daily_message_limit === null ? null : Math.max(0, linha.daily_message_limit - estado.sentToday),
      // O intervalo da PLATAFORMA soma-se ao pacing do número e ao da campanha.
      podeAgora: decisao.allow && intervaloDoCanalCumprido(estado.lastSentAt, intervaloMinimoDoCanal(linha.provider), agora),
      ultimoEnvio: estado.lastSentAt,
    },
  };
}
