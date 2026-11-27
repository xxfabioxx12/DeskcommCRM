/**
 * QUEM RECEBE A CONVERSA QUANDO A IA PASSA PARA UMA PESSOA NO SUPORTE (fork NODZ).
 *
 * O defeito: `performHumanHandoff` cala a IA e põe a conversa em `pending`
 * ("Aguardando atendimento"), mas não dá dono. A fila do especialista ("Minhas")
 * só mostra conversa atribuída a ele, então ficava vazia enquanto "Aguardando"
 * enchia. O handoff do MCP externo (`lib/mcp/tools/handoff.ts`) já atribuía; o
 * do motor interno, que é o que os agentes da casa usam, não.
 *
 * A regra (Fabio, 13/11/2026: "todo o suporte é do Henrique"; o comercial fica
 * como está):
 *   - só número do setor Suporte (nome "Suporte · …", `setorDoNome`);
 *   - entre os responsáveis do número, conta quem é membro ativo (agent+),
 *     menos o dono da organização (`organizations.created_by`): o Fabio está
 *     no número só para enxergar; o Henrique também é admin, por isso o corte
 *     não é por papel;
 *   - sobrou exatamente um → ele. Senão → ninguém (fica em Aguardando).
 *
 * Quando o contato não tem carteira, quem recebeu passa a ser o dono dela
 * (`fn_definir_carteira_do_cliente`, origem `automacao`, sem ator).
 */
import type pg from "pg";

import { setorDoNome } from "@/lib/inbox/recorte-do-setor";

export const SETOR_DA_PASSAGEM_DIRETA = "Suporte";

export interface FatosDaPassagem {
  nomeDoNumero: string | null;
  /** Responsáveis do número que são membro ativo, menos o dono da organização. */
  responsaveisAtendentes: readonly string[];
}

export function decidirDestinoDaPassagem(f: FatosDaPassagem): string | null {
  if (setorDoNome(f.nomeDoNumero) !== SETOR_DA_PASSAGEM_DIRETA) return null;
  return f.responsaveisAtendentes.length === 1 ? f.responsaveisAtendentes[0]! : null;
}

/**
 * Lê os fatos, decide e grava. Devolve quem recebeu (ou null) para o log.
 * Não atribui conversa que já tem dono (`p_enforce_expected` com dono nulo) e
 * não troca carteira que já existe.
 */
export async function entregarPassagemAoResponsavel(
  db: pg.Pool,
  ids: { tenantId: string; leadId: string; conversationId: string },
): Promise<string | null> {
  const { rows } = await db.query<{ nome: string | null; responsaveis: string[] | null; carteira: string | null }>(
    `select s.display_name as nome,
            (select array_agg(r.user_id order by r.user_id)
               from public.channel_routing_policies p
               join public.channel_routing_responsibles r on r.policy_id = p.id
               join public.user_organizations uo
                 on uo.organization_id = r.organization_id and uo.user_id = r.user_id
                and uo.accepted_at is not null and uo.revoked_at is null
                and uo.role in ('agent','manager','admin')
               join public.organizations o on o.id = cv.organization_id
              where p.organization_id = cv.organization_id
                and r.user_id is distinct from o.created_by
                and p.channel_session_id = cv.channel_session_id) as responsaveis,
            c.carteira_user_id as carteira
       from public.conversations cv
       join public.channel_sessions s on s.organization_id = cv.organization_id and s.id = cv.channel_session_id
       join public.contacts c on c.organization_id = cv.organization_id and c.id = $2
      where cv.organization_id = $1 and cv.id = $3`,
    [ids.tenantId, ids.leadId, ids.conversationId],
  );
  const linha = rows[0];
  if (!linha) return null;
  const destino = decidirDestinoDaPassagem({
    nomeDoNumero: linha.nome,
    responsaveisAtendentes: linha.responsaveis ?? [],
  });
  if (!destino) return null;

  if (!linha.carteira) {
    await db.query(`select public.fn_definir_carteira_do_cliente($1, null, $2, $3, 'automacao')`, [
      ids.tenantId,
      ids.leadId,
      destino,
    ]);
  }
  // Só se ainda estiver sem dono: nunca tira a conversa de quem já assumiu.
  await db.query(`select 1 from public.fn_conversation_assign($1, $2, $3, 'handoff', null, true)`, [
    ids.tenantId,
    ids.conversationId,
    destino,
  ]);
  return destino;
}
