import type {
  DadosPainelBarbearia,
  PeriodoBarbearia,
  ResumoBarbearia,
} from "@/components/barbearia/PainelBarbearia";
import { instanteDe } from "@/lib/agenda/fuso";

export type AgendaPainel = {
  id: string;
  starts_at: string;
  status: string;
  owner_user_id: string | null;
  contact_id: string | null;
  event_type_id: string | null;
  title: string;
};
export type EntradaPainel = {
  id: string;
  entry_date: string;
  amount_cents: number;
  currency: string;
  direction: string;
  status: string;
};
export type VendaPainel = {
  id: string;
  finalized_at: string | null;
  total_cents: number;
  currency: string;
  status: string;
  reversed_at: string | null;
};
export type ItemPainel = { sale_id: string; description: string; quantity: number };
export const diaLocal = (d: Date, fuso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(d);
const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export function periodosDoPainel(agora: Date, fuso: string) {
  const hoje = diaLocal(agora, fuso);
  const semana = somarDias(hoje, -new Date(`${hoje}T12:00:00Z`).getUTCDay());
  const mes = `${hoje.slice(0, 7)}-01`;
  const inicio = mes < semana ? mes : semana;
  const instante = (dia: string) => {
    const [ano, mes, d] = dia.split("-").map(Number) as [number, number, number];
    return instanteDe({ ano, mes, dia: d }, fuso).toISOString();
  };
  return {
    hoje,
    semana,
    mes,
    inicio,
    deUtc: instante(inicio),
    ateUtc: instante(somarDias(hoje, 1)),
  };
}
export interface FontePainel {
  organizacao: string;
  moeda: string;
  fuso: string;
  financeiroAtivo: boolean;
  agenda: AgendaPainel[];
  entradas: EntradaPainel[];
  vendas: VendaPainel[];
  itens: ItemPainel[];
  pessoas: { id: string; nome: string }[];
  contatos: { id: string; nome: string }[];
  tipos: { id: string; nome: string }[];
}
/** Agrega somente conjuntos completos já filtrados pela organização. Nunca mistura moedas,
 * dinheiro recebido com faturamento, estornos com vendas válidas, nem fusos do servidor. */
export function montarPainel(fonte: FontePainel, agora: Date): DadosPainelBarbearia {
  const p = periodosDoPainel(agora, fonte.fuso);
  const ativos = fonte.agenda.filter((a) => a.status !== "cancelled");
  const diaAgenda = (a: AgendaPainel) => diaLocal(new Date(a.starts_at), fonte.fuso);
  const entradas = fonte.entradas.filter(
    (e) => e.currency === fonte.moeda && e.status === "paid" && e.direction === "in",
  );
  const vendas = fonte.vendas.filter(
    (v) =>
      v.currency === fonte.moeda && v.status === "finalized" && !v.reversed_at && v.finalized_at,
  );
  const diaVenda = (v: VendaPainel) => diaLocal(new Date(v.finalized_at!), fonte.fuso);
  const periodos = Object.fromEntries(
    (["hoje", "semana", "mes"] as const).map((periodo) => {
      const de = periodo === "hoje" ? p.hoje : p[periodo];
      const entre = (dia: string) => dia >= de && dia <= p.hoje;
      const recebidas = entradas.filter((e) => entre(e.entry_date));
      const finalizadas = vendas.filter((v) => entre(diaVenda(v)));
      const agendadas = ativos.filter((a) => entre(diaAgenda(a)));
      const dias: string[] = [];
      for (let d = de; d <= p.hoje; d = somarDias(d, 1)) dias.push(d);
      // Até 7 grupos contíguos; soma das barras coincide com o total, inclusive mês longo.
      const tamanho = Math.max(1, Math.ceil(dias.length / 7));
      const serie = Array.from({ length: Math.ceil(dias.length / tamanho) }, (_, i) => {
        const grupo = dias.slice(i * tamanho, (i + 1) * tamanho);
        const fim = grupo[grupo.length - 1]!;
        return {
          label: grupo.length === 1 ? grupo[0]!.slice(8) : `${grupo[0]!.slice(8)}–${fim.slice(8)}`,
          centavos: recebidas
            .filter((e) => e.entry_date >= grupo[0]! && e.entry_date <= fim)
            .reduce((s, e) => s + e.amount_cents, 0),
        };
      });
      const resumo: ResumoBarbearia = {
        recebidoCentavos: recebidas.reduce((s, e) => s + e.amount_cents, 0),
        comandasFinalizadas: finalizadas.length,
        ticketMedioCentavos: finalizadas.length
          ? finalizadas.reduce((s, v) => s + v.total_cents, 0) / finalizadas.length
          : null,
        agendamentos: agendadas.length,
        aConfirmar: agendadas.filter((a) => a.status === "pending").length,
        serie,
      };
      return [periodo, resumo];
    }),
  ) as Record<PeriodoBarbearia, ResumoBarbearia>;
  const deHoje = ativos
    .filter((a) => diaAgenda(a) === p.hoje)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nomes = new Map(fonte.pessoas.map((p) => [p.id, p.nome]));
  const contatos = new Map(fonte.contatos.map((p) => [p.id, p.nome]));
  const tipos = new Map(fonte.tipos.map((p) => [p.id, p.nome]));
  const status: Record<string, DadosPainelBarbearia["agenda"][number]["status"]> = {
    pending: "A confirmar",
    confirmed: "Confirmado",
    completed: "Concluído",
    no_show: "Não compareceu",
  };
  const vendasMes = new Set(
    vendas.filter((v) => diaVenda(v) >= p.mes && diaVenda(v) <= p.hoje).map((v) => v.id),
  );
  const servicos = new Map<string, number>();
  for (const item of fonte.itens)
    if (vendasMes.has(item.sale_id))
      servicos.set(item.description, (servicos.get(item.description) ?? 0) + item.quantity);
  return {
    organizacao: fonte.organizacao,
    moeda: fonte.moeda,
    financeiroAtivo: fonte.financeiroAtivo,
    dataReferencia: new Intl.DateTimeFormat("pt-BR", {
      timeZone: fonte.fuso,
      dateStyle: "full",
    }).format(agora),
    aviso:
      fonte.entradas.some((e) => e.currency !== fonte.moeda) ||
      fonte.vendas.some((v) => v.currency !== fonte.moeda)
        ? `Este painel mostra apenas ${fonte.moeda}. Consulte outras moedas em Faturamento.`
        : undefined,
    periodos,
    agenda: deHoje.map((a) => ({
      id: a.id,
      hora: new Intl.DateTimeFormat("pt-BR", {
        timeZone: fonte.fuso,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(a.starts_at)),
      cliente: contatos.get(a.contact_id ?? "") ?? "Cliente não vinculado",
      servico: tipos.get(a.event_type_id ?? "") ?? a.title,
      profissional: nomes.get(a.owner_user_id ?? "") ?? "Sem profissional ativo",
      profissionalId: a.owner_user_id ?? "sem-profissional",
      status: status[a.status] ?? "Confirmado",
    })),
    equipe: fonte.pessoas.map((pessoa) => ({
      id: pessoa.id,
      nome: pessoa.nome,
      agendaHoje: deHoje.filter((a) => a.owner_user_id === pessoa.id).length,
    })),
    servicos: [...servicos]
      .map(([nome, quantidade]) => ({ nome, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade),
  };
}
