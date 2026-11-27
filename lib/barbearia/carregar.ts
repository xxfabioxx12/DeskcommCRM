import type { SupabaseClient } from "@supabase/supabase-js";
import { rotulosDosResponsaveisDaAgenda } from "@/lib/agenda/rotulos-dos-responsaveis";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import {
  montarPainel,
  periodosDoPainel,
  type AgendaPainel,
  type EntradaPainel,
  type VendaPainel,
} from "./dados";
import type { ItemPainel } from "./dados";

/** Paginação explícita: um painel nunca soma apenas a primeira página do PostgREST. */
export async function lerPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += 500) {
    const { data, error } = await pagina(de, de + 499);
    if (error || !data) throw new Error("Não foi possível carregar todos os dados do painel.");
    linhas.push(...data);
    if (data.length < 500) return linhas;
  }
}
export async function carregarPainel(
  db: SupabaseClient,
  org: { id: string; nome: string; moeda: string; fuso: string },
  financeiroAtivo: boolean,
  agora = new Date(),
) {
  const p = periodosDoPainel(agora, org.fuso);
  const [agenda, entradas, vendas, membros, tipos] = await Promise.all([
    lerPaginas<AgendaPainel>((de, ate) =>
      db
        .from("calendar_appointments")
        .select("id,starts_at,status,owner_user_id,contact_id,event_type_id,title")
        .eq("organization_id", org.id)
        .gte("starts_at", p.deUtc)
        .lt("starts_at", p.ateUtc)
        .order("id")
        .range(de, ate),
    ),
    lerPaginas<EntradaPainel>((de, ate) =>
      db
        .from("financial_entries")
        .select("id,entry_date,amount_cents,currency,direction,status")
        .eq("organization_id", org.id)
        .gte("entry_date", p.inicio)
        .lte("entry_date", p.hoje)
        .eq("status", "paid")
        .order("id")
        .range(de, ate),
    ),
    financeiroAtivo
      ? lerPaginas<VendaPainel>((de, ate) =>
          db
            .from("sales")
            .select("id,finalized_at,total_cents,currency,status,reversed_at")
            .eq("organization_id", org.id)
            .gte("finalized_at", p.deUtc)
            .lt("finalized_at", p.ateUtc)
            .order("id")
            .range(de, ate),
        )
      : [],
    lerPaginas<{ user_id: string }>((de, ate) =>
      db
        .from("user_organizations")
        .select("user_id")
        .eq("organization_id", org.id)
        .is("revoked_at", null)
        .not("accepted_at", "is", null)
        .neq("role", "ai_operator")
        .order("user_id")
        .range(de, ate),
    ),
    lerPaginas<{ id: string; name: string }>((de, ate) =>
      db
        .from("calendar_event_types")
        .select("id,name")
        .eq("organization_id", org.id)
        .order("id")
        .range(de, ate),
    ),
  ]);
  const itens: ItemPainel[] = [];
  // .in de lotes pequenos evita URLs gigantes e lê só os itens das vendas do período.
  for (let i = 0; i < vendas.length; i += 100)
    itens.push(
      ...(await lerPaginas<ItemPainel>((de, ate) =>
        db
          .from("sale_items")
          .select("sale_id,description,quantity")
          .eq("organization_id", org.id)
          .in(
            "sale_id",
            vendas.slice(i, i + 100).map((v) => v.id),
          )
          .order("id")
          .range(de, ate),
      )),
    );
  const idsContatos = [
    ...new Set(agenda.map((a) => a.contact_id).filter((id): id is string => !!id)),
  ];
  const contatos: { id: string; nome: string }[] = [];
  for (let i = 0; i < idsContatos.length; i += 100) {
    const linhas = await lerPaginas<{
      id: string;
      name: string | null;
      display_name: string | null;
    }>((de, ate) =>
      db
        .from("contacts")
        .select("id,name,display_name")
        .eq("organization_id", org.id)
        .in("id", idsContatos.slice(i, i + 100))
        .order("id")
        .range(de, ate),
    );
    contatos.push(
      ...linhas.map((c) => ({ id: c.id, nome: nomeDoContato(c) ?? "Cliente sem nome" })),
    );
  }
  const identidades = await rotulosDosResponsaveisDaAgenda(membros.map((m) => m.user_id));
  return montarPainel(
    {
      organizacao: org.nome,
      moeda: org.moeda,
      fuso: org.fuso,
      financeiroAtivo,
      agenda,
      entradas,
      vendas,
      itens,
      contatos,
      tipos: tipos.map((t) => ({ id: t.id, nome: t.name })),
      pessoas: membros.map((m) => ({
        id: m.user_id,
        nome: identidades.get(m.user_id)?.display_label ?? "Profissional",
      })),
    },
    agora,
  );
}
