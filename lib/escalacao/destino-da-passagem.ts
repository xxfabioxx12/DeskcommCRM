/**
 * QUEM RECEBE A CONVERSA QUANDO A IA PASSA PARA UMA PESSOA (fork NODZ).
 *
 * O defeito: `performHumanHandoff` cala a IA e põe a conversa em `pending`
 * ("Aguardando atendimento"), mas não dá dono. A fila do especialista ("Minhas")
 * só mostra conversa atribuída a ele, então ficava vazia enquanto "Aguardando"
 * enchia. O handoff do MCP externo (`lib/mcp/tools/handoff.ts`) já atribuía; o
 * do motor interno, que é o que os agentes da casa usam, não.
 *
 * A regra (Fabio, 13/11/2026: "todo o suporte é do Henrique"):
 *   1. o número da conversa tem UM responsável qualificado → ele;
 *   2. senão, o dono da carteira do contato, se qualificado → ele;
 *   3. senão → ninguém (a conversa fica em Aguardando, como antes).
 * O responsável do número vem antes da carteira de propósito: no suporte, o
 * especialista é quem atende o número, mesmo que o cliente tenha comprado com
 * outro vendedor.
 *
 * Quando o contato não tem carteira, quem recebeu passa a ser o dono dela
 * (`fn_definir_carteira_do_cliente`, origem `automacao`, sem ator).
 */
import type pg from "pg";

export interface FatosDaPassagem {
  /** Responsáveis QUALIFICADOS do número da conversa (membro ativo, papel agent+). */
  responsaveisDoNumero: readonly string[];
  /** `contacts.carteira_user_id`, qualificado ou não. */
  carteira: string | null;
  carteiraQualificada: boolean;
}

export type DestinoDaPassagem =
  | { userId: string; motivo: "responsavel_do_numero" | "dono_da_carteira" }
  | { userId: null; motivo: "sem_destino" };

export function decidirDestinoDaPassagem(f: FatosDaPassagem): DestinoDaPassagem {
  if (f.responsaveisDoNumero.length === 1) {
    return { userId: f.responsaveisDoNumero[0]!, motivo: "responsavel_do_numero" };
  }
  if (f.carteira && f.carteiraQualificada) return { userId: f.carteira, motivo: "dono_da_carteira" };
  return { userId: null, motivo: "sem_destino" };
}

const QUALIFICADO = `uo.accepted_at is not null and uo.revoked_at is null and uo.role in ('agent','manager','admin')`;

/**
 * Lê os fatos, decide e grava. Devolve o destino para o log de quem chama.
 * Não atribui conversa que já tem dono (`p_enforce_expected` com dono nulo) e
 * não troca carteira que já existe.
 */
export async function entregarPassagemAoResponsavel(
  db: pg.Pool,
  ids: { tenantId: string; leadId: string; conversationId: string },
): Promise<DestinoDaPassagem> {
  const { rows } = await db.query<{
    responsaveis: string[] | null;
    carteira: string | null;
    carteira_qualificada: boolean;
  }>(
    `select
       (select array_agg(r.user_id order by r.user_id)
          from public.conversations cv
          join public.channel_routing_policies p
            on p.organization_id = cv.organization_id and p.channel_session_id = cv.channel_session_id
          join public.channel_routing_responsibles r on r.policy_id = p.id
          join public.user_organizations uo
            on uo.organization_id = r.organization_id and uo.user_id = r.user_id and ${QUALIFICADO}
         where cv.organization_id = $1 and cv.id = $3) as responsaveis,
       c.carteira_user_id as carteira,
       exists (select 1 from public.user_organizations uo
                where uo.organization_id = $1 and uo.user_id = c.carteira_user_id and ${QUALIFICADO})
         as carteira_qualificada
     from public.contacts c
    where c.organization_id = $1 and c.id = $2`,
    [ids.tenantId, ids.leadId, ids.conversationId],
  );
  const linha = rows[0];
  const destino = decidirDestinoDaPassagem({
    responsaveisDoNumero: linha?.responsaveis ?? [],
    carteira: linha?.carteira ?? null,
    carteiraQualificada: linha?.carteira_qualificada ?? false,
  });
  if (!destino.userId || !linha) return destino;

  if (!linha.carteira) {
    await db.query(
      `select public.fn_definir_carteira_do_cliente($1, null, $2, $3, 'automacao')`,
      [ids.tenantId, ids.leadId, destino.userId],
    );
  }
  // Só se ainda estiver sem dono: nunca tira a conversa de quem já assumiu.
  await db.query(
    `select 1 from public.fn_conversation_assign($1, $2, $3, 'handoff', null, true)`,
    [ids.tenantId, ids.conversationId, destino.userId],
  );
  return destino;
}
