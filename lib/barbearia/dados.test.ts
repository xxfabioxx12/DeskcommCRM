import { describe, it, expect } from "vitest";
import { montarPainel, periodosDoPainel, type FontePainel } from "./dados";
import { painelBarbeariaLigado } from "./config";
import { capacidadesLigadas } from "@/lib/organizacao/capacidades";
import { destinosDaInterface } from "@/lib/navigation/interface";
const fonte = (): FontePainel => ({
  organizacao: "A",
  moeda: "BRL",
  fuso: "America/Sao_Paulo",
  financeiroAtivo: true,
  agenda: [],
  entradas: [],
  vendas: [],
  itens: [],
  pessoas: [],
  contatos: [],
  tipos: [],
});
describe("painel da barbearia", () => {
  it("ausência, string e false não ligam; outra organização mantém a navegação", () => {
    for (const settings of [
      null,
      {},
      [],
      { painel_barbearia: "true" },
      { painel_barbearia: false },
    ])
      expect(painelBarbeariaLigado(settings)).toBe(false);
    const caps = capacidadesLigadas({ painel_barbearia: true }, []);
    expect(caps).toContain("painel_barbearia");
    const menu = (role: "manager" | "agent", c: typeof caps) =>
      destinosDaInterface({}, false, role, [], c).map((d) => d.href);
    expect(menu("manager", caps)).toContain("/app/painel-da-barbearia");
    expect(menu("manager", [])).not.toContain("/app/painel-da-barbearia");
    expect(menu("agent", caps)).not.toContain("/app/painel-da-barbearia");
  });
  it("usa o dia da organização na virada UTC e inclui semana que cruza o mês", () => {
    const p = periodosDoPainel(new Date("2026-11-01T01:00:00Z"), "America/Sao_Paulo");
    expect(p.hoje).toBe("2026-10-31");
    expect(p.mes).toBe("2026-10-01");
    expect(p.ateUtc).toBe("2026-11-01T03:00:00.000Z");
    expect(periodosDoPainel(new Date("2026-10-01T12:00:00Z"), "America/Sao_Paulo").inicio).toBe(
      "2026-09-27",
    );
  });
  it("não confunde recebido, comanda, estorno, moeda e ticket médio", () => {
    const f = fonte();
    f.entradas = [
      {
        id: "1",
        entry_date: "2026-11-08",
        amount_cents: 5000,
        currency: "BRL",
        direction: "in",
        status: "paid",
      },
      {
        id: "2",
        entry_date: "2026-11-08",
        amount_cents: 99999,
        currency: "USD",
        direction: "in",
        status: "paid",
      },
      {
        id: "3",
        entry_date: "2026-11-08",
        amount_cents: 2000,
        currency: "BRL",
        direction: "out",
        status: "paid",
      },
      {
        id: "4",
        entry_date: "2026-11-08",
        amount_cents: 6000,
        currency: "BRL",
        direction: "in",
        status: "pending",
      },
    ];
    f.vendas = [
      {
        id: "v1",
        finalized_at: "2026-11-08T12:00:00Z",
        total_cents: 9000,
        currency: "BRL",
        status: "finalized",
        reversed_at: null,
      },
      {
        id: "v2",
        finalized_at: "2026-11-08T12:00:00Z",
        total_cents: 5000,
        currency: "BRL",
        status: "finalized",
        reversed_at: "2026-11-08T13:00:00Z",
      },
    ];
    f.itens = [
      { sale_id: "v1", description: "Corte", quantity: 1 },
      { sale_id: "v2", description: "Barba", quantity: 2 },
    ];
    const d = montarPainel(f, new Date("2026-11-08T15:00:00Z"));
    expect(d.periodos.hoje.recebidoCentavos).toBe(5000);
    expect(d.periodos.hoje.comandasFinalizadas).toBe(1);
    expect(d.periodos.hoje.ticketMedioCentavos).toBe(9000);
    expect(d.servicos).toEqual([{ nome: "Corte", quantidade: 1 }]);
    expect(d.aviso).toContain("BRL");
    expect(d.periodos.mes.serie.reduce((s, p) => s + p.centavos, 0)).toBe(
      d.periodos.mes.recebidoCentavos,
    );
  });
  it("preserva profissionais homônimos e faltas; cancela fora da contagem", () => {
    const f = fonte();
    f.pessoas = [
      { id: "p1", nome: "João" },
      { id: "p2", nome: "João" },
    ];
    f.agenda = ["no_show", "confirmed", "cancelled"].map((status, i) => ({
      id: String(i),
      status,
      starts_at: "2026-11-08T15:00:00Z",
      owner_user_id: i === 0 ? "p1" : "p2",
      contact_id: null,
      event_type_id: null,
      title: "Corte",
    }));
    const d = montarPainel(f, new Date("2026-11-08T15:00:00Z"));
    expect(d.periodos.hoje.agendamentos).toBe(2);
    expect(d.agenda[0]!.status).toBe("Não compareceu");
    expect(d.equipe.map((p) => p.agendaHoje)).toEqual([1, 1]);
    expect(d.periodos.hoje.ticketMedioCentavos).toBeNull();
  });
});
