/**
 * O SUPORTE CONCLUI SOZINHO QUANDO A IA FALOU POR ÚLTIMO E O CLIENTE SUMIU (fork NODZ).
 *
 * O defeito: a IA responde, o cliente fica satisfeito e para de escrever, mas
 * ninguém clica em Concluir — a conversa fica "Em atendimento" para sempre e o
 * painel do setor enche de gente que não precisa de ninguém.
 *
 * A regra (Fabio, 13/11/2026): a IA mandou a última mensagem, passou o prazo
 * (60 min na NODZ) e o cliente não respondeu → o atendimento terminou.
 *   - só número do setor Suporte (o comercial fica como está);
 *   - não fecha conversa com vendedor, esperando um (`pending`, chamado aberto)
 *     ou com a IA calada por passagem — essa é do Henrique concluir.
 *
 * Ligada por organização em `settings.concluir_ia_sem_resposta_minutos`. Fica
 * fora de `settings.routing` de propósito: o PATCH de Distribuição reescreve
 * `routing` pelo schema e apagaria a chave.
 */
import type pg from "pg";

import { SETOR_DA_PASSAGEM_DIRETA } from "@/lib/escalacao/destino-da-passagem";
import { setorDoNome } from "@/lib/inbox/recorte-do-setor";

export interface FatosDaConversaParada {
  nomeDoNumero: string | null;
  status: string;
  vendedor: string | null;
  casoAberto: boolean;
  /** `bot_silenced_until` no futuro (passagem cala com 'infinity'). */
  iaCalada: boolean;
  /** Última mensagem que não falhou. */
  ultima: { direcao: string; via: string | null; em: string } | null;
  ultimaDoCliente: string | null;
  minutos: number;
}

export function lerMinutosDoPrazo(settings: unknown): number | null {
  const v = (settings as { concluir_ia_sem_resposta_minutos?: unknown } | null)?.concluir_ia_sem_resposta_minutos;
  return typeof v === "number" && Number.isInteger(v) && v >= 5 ? v : null;
}

export function deveConcluir(f: FatosDaConversaParada, agoraMs: number): boolean {
  if (setorDoNome(f.nomeDoNumero) !== SETOR_DA_PASSAGEM_DIRETA) return false;
  if (f.status !== "open" && f.status !== "ai_handling") return false;
  if (f.vendedor || f.casoAberto || f.iaCalada) return false;
  if (!f.ultima || f.ultima.direcao !== "outbound" || f.ultima.via !== "ai") return false;
  const ultimaMs = Date.parse(f.ultima.em);
  if (f.ultimaDoCliente && Date.parse(f.ultimaDoCliente) >= ultimaMs) return false;
  return agoraMs - ultimaMs >= f.minutos * 60_000;
}

/** Os fatos de cada conversa candidata; com `conversationId`, só ela e travada (`for update`). */
export async function lerConversasParadas(
  db: Pick<pg.PoolClient, "query">,
  opts: { conversationId?: string; limite: number },
): Promise<Array<FatosDaConversaParada & { id: string; organizationId: string; revisao: number }>> {
  const { rows } = await db.query(
    `select cv.id, cv.organization_id, cv.service_revision, cv.status, cv.assigned_to_user_id,
            coalesce(cv.bot_silenced_until > now(), false) as ia_calada, cv.last_inbound_at, s.display_name, o.settings,
            exists (select 1 from public.agent_cases k
                     where k.organization_id = cv.organization_id and k.conversation_id = cv.id
                       and k.status in ('awaiting_human','awaiting_lead')) as caso_aberto,
            u.direction, u.sent_via, u.sent_at
       from public.conversations cv
       join public.organizations o on o.id = cv.organization_id
       join public.channel_sessions s on s.organization_id = cv.organization_id and s.id = cv.channel_session_id
       left join lateral (
         select m.direction, m.sent_via, m.sent_at from public.messages m
          where m.organization_id = cv.organization_id and m.conversation_id = cv.id
            and m.status <> 'failed' and m.type not in ('reaction','system')
          order by m.sent_at desc limit 1) u on true
      where o.settings ? 'concluir_ia_sem_resposta_minutos' and public.fn_org_operante(cv.organization_id)
        and cv.status in ('open','ai_handling') and cv.assigned_to_user_id is null and cv.is_group = false
        and s.display_name like $1
        and ($2::uuid is null or cv.id = $2)
      order by cv.last_message_at nulls first
      limit $3
      ${opts.conversationId ? "for update of cv" : ""}`,
    [`${SETOR_DA_PASSAGEM_DIRETA} · %`, opts.conversationId ?? null, opts.limite],
  );
  return rows.flatMap((r) => {
    const minutos = lerMinutosDoPrazo(r.settings);
    if (minutos === null) return [];
    const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
    return [{
      id: r.id,
      organizationId: r.organization_id,
      revisao: Number(r.service_revision),
      nomeDoNumero: r.display_name,
      status: r.status,
      vendedor: r.assigned_to_user_id,
      casoAberto: r.caso_aberto,
      iaCalada: r.ia_calada,
      ultima: r.sent_at ? { direcao: r.direction, via: r.sent_via, em: iso(r.sent_at)! } : null,
      ultimaDoCliente: iso(r.last_inbound_at),
      minutos,
    }];
  });
}
