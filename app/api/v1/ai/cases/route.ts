/**
 * GET /api/v1/ai/cases — lista os casos humanos da org (spec 15 §7, Wave 5).
 * Read-only via PostgREST (`createAdminClient`) — a escrita de estado do caso
 * mora em POST /api/v1/ai/cases/[id]/reply (pg.Pool do engine, ver ADR ali).
 *
 * A consulta em si vive em `lib/escalacao/chamados.ts`: a capacidade "ver os
 * chamados em aberto" do agente lê exatamente a mesma lista, e a tela e o agente
 * discordarem sobre o que está aberto seria o pior tipo de divergência.
 *
 * O que a tela e o agente NÃO compartilham é o alcance: `conversations` tem RLS
 * por atendente, e esta lista devolve nome e telefone do contato. Por isso o
 * conjunto de conversas visíveis é resolvido ANTES, com o cliente de SESSÃO — é
 * a policy do banco que responde, não uma cópia da regra aqui —, e a divergência
 * vai declarada no argumento `visiveisPara` (o agente passa `"todas"`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { ok, fail } from "@/lib/api/wrappers";
import { conversasVisiveisDosCasos, listarChamados, type ConversasVisiveis } from "@/lib/escalacao/chamados";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { filtroDoSetorPara, idsDoSetorEscolhido } from "@/lib/inbox/recorte-do-setor";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  // Fork NODZ: `waiting` (esperando a equipe) e `answered` (respondido,
  // esperando o cliente) são as duas metades de `open` — uma aba cada.
  channel_session_id: z.string().uuid().optional(),
  status: z.enum(["open", "resolved", "waiting", "answered"]).default("open"),
});

const ESTADO_DO_STATUS = {
  open: "abertos",
  resolved: "fechados",
  waiting: "aguardando",
  answered: "respondidos",
} as const;

/** Última resposta de pessoa da equipe (CRM ou celular, nunca IA/automação) depois de o Caso abrir. */
async function respostasHumanas(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  chamados: ReadonlyArray<{ conversation_id: string; opened_at: string; status: string }>,
): Promise<Map<string, string>> {
  const esperando = chamados.filter((c) => c.status === "awaiting_human");
  const resultado = new Map<string, string>();
  if (esperando.length === 0) return resultado;
  const maisAntigo = esperando.map((c) => c.opened_at).sort()[0] as string;
  // shortcut: lê até 5000 respostas desde o Caso mais antigo; se a fila crescer muito, mover para SQL agregado.
  const { data, error } = await admin
    .from("messages")
    .select("conversation_id, sent_at")
    .eq("organization_id", organizationId)
    .in("conversation_id", [...new Set(esperando.map((c) => c.conversation_id))])
    .eq("direction", "outbound")
    .in("sent_via", ["user", "external_device"])
    .gte("sent_at", maisAntigo)
    .order("sent_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  const abertoEm = new Map(esperando.map((c) => [c.conversation_id, c.opened_at]));
  for (const m of (data ?? []) as Array<{ conversation_id: string; sent_at: string }>) {
    if (resultado.has(m.conversation_id)) continue;
    const desde = abertoEm.get(m.conversation_id);
    if (desde && new Date(m.sent_at) > new Date(desde)) resultado.set(m.conversation_id, m.sent_at);
  }
  return resultado;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  // Sessão OU token (Spec 33, R1): o token precisa de config:read e papel admin.
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "agent_cases",
    role: "agent",
    scope: "config:read",
    tokenRole: "admin",
  });
  if (!authz.ok) return authz.response;
  const teto = await tetoDeEscritaDoToken(authz, "agent_cases", requestId);
  if (teto) return teto;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  const org = { orgId: authz.organizationId };

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  try {
    // A ordem importa: o recorte é resolvido pelo cliente de SESSÃO (RLS
    // aplicada) ANTES da leitura privilegiada. Manager e admin seguem vendo
    // tudo porque é `fn_can_view_conversation` que decide — eles são org-wide
    // por desenho, e não há regra de papel repetida aqui para desatualizar.
    // Cópia NODZ: `?setor=` e `channel_session_id` recortam a fila por número.
    const doSetor = await idsDoSetorEscolhido(
      org.orgId,
      new URL(req.url).searchParams.get("setor"),
    );
    const canal = parsed.data.channel_session_id;
    const canais = canal ? (doSetor && !doSetor.includes(canal) ? [] : [canal]) : doSetor;
    // Token: admin é org-wide por desenho (o mesmo que a RLS devolveria), então
    // o recorte é "todas" (ou só os números pedidos); a organização continua
    // filtrada em toda consulta. Sessão: RLS + recorte do setor do atendente.
    const visiveisPara: ConversasVisiveis =
      authz.via === "token"
        ? canais
          ? await conversasVisiveisDosCasos(authz.supabase, org.orgId, { canais })
          : "todas"
        : await conversasVisiveisDosCasos(authz.supabase, org.orgId, {
            filtroDoSetor: await filtroDoSetorPara(org.orgId, authz.actor.id),
            canais,
          });
    const admin = createAdminClient();
    const { chamados, abertos, aguardando } = await listarChamados(admin, org.orgId, {
      estado: ESTADO_DO_STATUS[parsed.data.status],
      visiveisPara,
      contatoSeparado: authz.via === "token",
    });
    // Cópia NODZ: resposta da equipe pelo celular não tira o Caso de awaiting_human;
    // o Painel do setor usa este campo para não deixar o cliente respondido em Aguardando.
    let humanoRespondeuEm = new Map<string, string>();
    if (authz.via !== "token") {
      try {
        humanoRespondeuEm = await respostasHumanas(admin, org.orgId, chamados);
      } catch (erro) {
        // Só informativo: sem ele o painel volta à regra antiga, a lista de casos não cai.
        logger.warn("[ai/cases] falha ao ler respostas humanas", {
          requestId,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
    return ok(
      {
        cases: chamados.map((c) => ({
          ...c,
          humano_respondeu_em: humanoRespondeuEm.get(c.conversation_id) ?? null,
        })),
        open_count: abertos,
        waiting_count: aguardando,
        answered_count: abertos - aguardando,
      },
      { requestId },
    );
  } catch (erro) {
    /**
     * O `catch` era NU, e a fila de casos ficava sem causa em lugar nenhum.
     *
     * Medido em 2026-09-18 na prova em tela: a tela mostrou "Nenhum caso
     * aberto" por 60 s seguidos enquanto o banco tinha o caso em
     * `awaiting_human` — o 500 daqui vira `data === undefined` no React Query,
     * e o componente não distingue "não há casos" de "não deu para saber".
     * Quem estava diagnosticando tinha o banco correto, a tela vazia e NADA
     * escrito entre os dois: o log do servidor não dizia uma palavra, porque
     * este `catch` descartava o erro antes de qualquer um vê-lo.
     *
     * A frase para quem lê a tela não muda (genérica de propósito: a causa é do
     * operador, não do atendente). O que muda é existir causa registrada — e é
     * a diferença entre "falhar fechado na ação, aberto na informação" e
     * simplesmente falhar.
     */
    logger.error("[ai/cases] falha ao listar os chamados", {
      requestId,
      organizationId: org.orgId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("internal_error", t("Falha ao carregar os casos."), 500, { requestId });
  }
}
