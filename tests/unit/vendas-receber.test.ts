import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ContatoExistente } from "@/lib/vendas/contato";
import type { EntregaDaVenda } from "@/lib/vendas/plataformas/tipos";
import {
  MOTIVO_DA_VENDA,
  SEIS_HORAS_MS,
  receberVenda,
  type BancoDaVenda,
  type ConexaoDeVenda,
  type FimDaVenda,
  type LinhaNovaDaVenda,
} from "@/lib/vendas/receber";

const fixture = (nome: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "vendas", `${nome}.json`), "utf8"));

const AGORA = new Date("2026-10-21T15:00:00Z");
const LIGADA: ConexaoDeVenda = { id: "conexao-1", organizationId: "org-1", plataforma: "hotmart", config: { dispara: true } };

function entrega(payload: Record<string, unknown>, conexao: ConexaoDeVenda = LIGADA): EntregaDaVenda {
  return { payload, corpo: JSON.stringify(payload), cabecalho: () => null, config: conexao.config };
}

function bancoFalso(over: Partial<BancoDaVenda> = {}) {
  const linhas: LinhaNovaDaVenda[] = [];
  const fins: Array<[string, FimDaVenda]> = [];
  const chaves = new Set<string>();
  const banco: BancoDaVenda = {
    registrar: vi.fn(async (linha: LinhaNovaDaVenda) => {
      const chave = `${linha.webhook_source_id}|${linha.chave_evento}`;
      if (chaves.has(chave)) return "repetido" as const;
      chaves.add(chave);
      linhas.push(linha);
      return { id: `ev-${linhas.length}` };
    }),
    concluir: vi.fn(async (id: string, fim: FimDaVenda) => {
      fins.push([id, fim]);
    }),
    marcarRecebimento: vi.fn(async () => undefined),
    jaComprou: vi.fn(async () => false),
    acharContato: vi.fn(async (): Promise<ContatoExistente | null> => null),
    criarContato: vi.fn(async (): Promise<string | null> => "contato-novo"),
    completarContato: vi.fn(async () => undefined),
    emitir: vi.fn(async () => undefined),
    ...over,
  };
  return { banco, linhas, fins };
}

describe("receberVenda", () => {
  it("venda aprovada: registra, cria o contato com a origem e emite sale.received sem dado pessoal", async () => {
    const { banco, linhas, fins } = bancoFalso();
    const r = await receberVenda(banco, LIGADA, entrega(fixture("hotmart_purchase_approved")), AGORA);
    expect(r).toEqual({ duplicate: false, status: "processado", motivo: null, salesEventId: "ev-1" });
    expect(linhas[0]).toMatchObject({
      organization_id: "org-1",
      webhook_source_id: "conexao-1",
      plataforma: "hotmart",
      evento_original: "PURCHASE_APPROVED",
      evento: "compra.aprovada",
      chave_evento: "hm-evt-0001",
      entidade: "hotmart:HP0001",
      pedido: "HP0001",
      produto_id: "4455",
      email: "joao@email.com",
      telefone: "+5531999998888",
      order_bump: false,
      teste: false,
    });
    expect(linhas[0]!.venda).toMatchObject({ nome: "João Comprador", valor: "297,90" });
    expect(banco.criarContato).toHaveBeenCalledWith("org-1", {
      name: "João Comprador",
      email: "joao@email.com",
      phone_number: "+5531999998888",
      source_metadata: {
        origem: "Comprou Curso Hotmart (Hotmart, pedido HP0001, 21/10/2026) e aceitou receber mensagens no WhatsApp no checkout",
        webhook_source_id: "conexao-1",
        sales_event_id: "ev-1",
        plataforma: "hotmart",
      },
    });
    expect(banco.emitir).toHaveBeenCalledWith(
      "org-1",
      "contato-novo",
      expect.objectContaining({
        evento: "compra.aprovada",
        plataforma: "hotmart",
        conexao_id: "conexao-1",
        produto_id: "4455",
        produto: "Curso Hotmart",
        oferta: "Oferta X",
        pedido: "HP0001",
        entidade: "hotmart:HP0001",
        valor: 29790,
        order_bump: false,
        sales_event_id: "ev-1",
        contact_id: "contato-novo",
      }),
      "venda:ev-1",
    );
    // F1: o evento vai para o event_log (sem poda): nada de dado pessoal nele.
    const emitido = vi.mocked(banco.emitir).mock.calls[0]![2];
    expect(emitido).not.toHaveProperty("venda");
    expect(JSON.stringify(emitido)).not.toMatch(/joao@email\.com|5531999998888|João/);
    expect(fins).toEqual([["ev-1", { status: "processado", motivo: null, contactId: "contato-novo" }]]);
    expect(banco.marcarRecebimento).toHaveBeenCalledWith("conexao-1");
  });

  it("repetido: devolve duplicate e nada roda de novo", async () => {
    const { banco } = bancoFalso();
    const p = fixture("hotmart_purchase_approved");
    await receberVenda(banco, LIGADA, entrega(p), AGORA);
    const r = await receberVenda(banco, LIGADA, entrega(p), AGORA);
    expect(r).toMatchObject({ duplicate: true, salesEventId: null });
    expect(banco.emitir).toHaveBeenCalledTimes(1);
    expect(banco.concluir).toHaveBeenCalledTimes(1);
  });

  it("teste da Kookie: registra como ignorado e nada roda", async () => {
    const kookie: ConexaoDeVenda = { ...LIGADA, plataforma: "kookie" };
    const { banco, linhas, fins } = bancoFalso();
    await receberVenda(banco, kookie, entrega({ ...fixture("kookie_venda_aprovada"), test: true }, kookie), AGORA);
    expect(linhas[0]!.teste).toBe(true);
    expect(fins[0]![1]).toEqual({ status: "ignorado", motivo: MOTIVO_DA_VENDA.teste });
    expect(banco.acharContato).not.toHaveBeenCalled();
    expect(banco.emitir).not.toHaveBeenCalled();
  });

  it("conexão só registrando: guarda a venda e não toca contato nem emite", async () => {
    const registrando: ConexaoDeVenda = { ...LIGADA, config: {} };
    const { banco, fins } = bancoFalso();
    await receberVenda(banco, registrando, entrega(fixture("hotmart_purchase_approved"), registrando), AGORA);
    expect(fins[0]![1]).toEqual({ status: "ignorado", motivo: MOTIVO_DA_VENDA.soRegistrando });
    expect(banco.acharContato).not.toHaveBeenCalled();
    expect(banco.criarContato).not.toHaveBeenCalled();
    expect(banco.emitir).not.toHaveBeenCalled();
  });

  it("evento sem tradução: ignorado com o evento original", async () => {
    const { banco, linhas, fins } = bancoFalso();
    await receberVenda(banco, LIGADA, entrega({ id: "x1", event: "PURCHASE_PROTEST", data: {} }), AGORA);
    expect(linhas[0]!.evento).toBeNull();
    expect(fins[0]![1]).toEqual({ status: "ignorado", motivo: "evento sem tradução: PURCHASE_PROTEST" });
  });

  it("personalizada sem mapa: falhou, com a orientação", async () => {
    const semMapa: ConexaoDeVenda = { id: "c2", organizationId: "org-1", plataforma: "personalizada", config: { dispara: true } };
    const { banco, fins } = bancoFalso();
    await receberVenda(banco, semMapa, entrega({ a: 1 }, semMapa), AGORA);
    expect(fins[0]![1]).toEqual({ status: "falhou", motivo: MOTIVO_DA_VENDA.semMapa });
  });

  it("sem telefone e sem e-mail: sem_contato e nada roda", async () => {
    const p = fixture("hotmart_purchase_approved");
    p.data.buyer = { name: "Sem Contato" };
    const { banco, fins } = bancoFalso();
    await receberVenda(banco, LIGADA, entrega(p), AGORA);
    expect(fins[0]![1]).toEqual({ status: "sem_contato", motivo: MOTIVO_DA_VENDA.semContato });
    expect(banco.emitir).not.toHaveBeenCalled();
  });

  it("recuperação de quem já comprou: ignorado 'já comprou', sem contato e sem gatilho", async () => {
    const p = fixture("hotmart_purchase_approved");
    p.event = "PURCHASE_BILLET_PRINTED";
    const { banco, fins } = bancoFalso({ jaComprou: vi.fn(async () => true) });
    await receberVenda(banco, LIGADA, entrega(p), AGORA);
    expect(banco.jaComprou).toHaveBeenCalledWith({
      organizationId: "org-1",
      conexaoId: "conexao-1",
      entidade: "hotmart:HP0001",
      email: "joao@email.com",
      telefone: "+5531999998888",
      produtoId: "4455",
      desde: new Date(AGORA.getTime() - SEIS_HORAS_MS),
    });
    expect(fins[0]![1]).toEqual({ status: "ignorado", motivo: MOTIVO_DA_VENDA.jaComprou });
    expect(banco.acharContato).not.toHaveBeenCalled();
    expect(banco.emitir).not.toHaveBeenCalled();
  });

  it("recuperação de quem não comprou: roda; aprovada nem pergunta", async () => {
    const p = fixture("hotmart_purchase_approved");
    p.event = "PURCHASE_BILLET_PRINTED";
    const { banco, fins } = bancoFalso();
    await receberVenda(banco, LIGADA, entrega(p), AGORA);
    expect(fins[0]![1].status).toBe("processado");
    const { banco: outro } = bancoFalso();
    await receberVenda(outro, LIGADA, entrega(fixture("hotmart_purchase_approved")), AGORA);
    expect(outro.jaComprou).not.toHaveBeenCalled();
  });

  it("contato existente: completa só o que falta e não cria outro", async () => {
    const existente: ContatoExistente = { id: "c1", name: "Já Tinha", email: null, phone_number: "+5531999998888" };
    const { banco, fins } = bancoFalso({ acharContato: vi.fn(async () => existente) });
    await receberVenda(banco, LIGADA, entrega(fixture("hotmart_purchase_approved")), AGORA);
    expect(banco.acharContato).toHaveBeenCalledWith("org-1", { telefone: "+5531999998888", email: "joao@email.com" });
    expect(banco.completarContato).toHaveBeenCalledWith("org-1", "c1", { email: "joao@email.com" });
    expect(banco.criarContato).not.toHaveBeenCalled();
    expect(banco.emitir).toHaveBeenCalledWith("org-1", "c1", expect.objectContaining({ contact_id: "c1" }), "venda:ev-1");
    expect(fins[0]![1]).toEqual({ status: "processado", motivo: null, contactId: "c1" });
  });

  it("e-mail inválido e telefone válido: cria o contato só com o telefone", async () => {
    const p = fixture("hotmart_purchase_approved");
    p.data.buyer.email = "joao@";
    const { banco, fins } = bancoFalso();
    await receberVenda(banco, LIGADA, entrega(p), AGORA);
    expect(banco.criarContato).toHaveBeenCalledWith("org-1", expect.objectContaining({ email: null, phone_number: "+5531999998888" }));
    expect(fins[0]![1].status).toBe("processado");
  });

  it("não conseguiu criar o contato: falhou, sem gatilho", async () => {
    const { banco, fins } = bancoFalso({ criarContato: vi.fn(async () => null) });
    await receberVenda(banco, LIGADA, entrega(fixture("hotmart_purchase_approved")), AGORA);
    expect(fins[0]![1]).toEqual({ status: "falhou", motivo: MOTIVO_DA_VENDA.contatoNaoCriado });
    expect(banco.emitir).not.toHaveBeenCalled();
  });

  it("erro depois do registro: falhou com a mensagem, e a resposta segue", async () => {
    const { banco, fins } = bancoFalso({
      emitir: vi.fn(async () => {
        throw new Error("emit_event: boom");
      }),
    });
    const r = await receberVenda(banco, LIGADA, entrega(fixture("hotmart_purchase_approved")), AGORA);
    expect(r).toMatchObject({ duplicate: false, status: "falhou", motivo: "emit_event: boom" });
    expect(fins[0]![1]).toEqual({ status: "falhou", motivo: "emit_event: boom" });
  });

  it("erro NO registro sobe (a rota responde 500 e a plataforma reentrega)", async () => {
    const { banco } = bancoFalso({
      registrar: vi.fn(async () => {
        throw new Error("sales_events: conexão caiu");
      }),
    });
    await expect(receberVenda(banco, LIGADA, entrega(fixture("hotmart_purchase_approved")), AGORA)).rejects.toThrow(/conexão caiu/);
  });

  it("valores longos: a linha sai cortada nos limites dos CHECKs da 9003", async () => {
    const flix: ConexaoDeVenda = {
      id: "c3",
      organizationId: "org-1",
      plataforma: "personalizada",
      config: { mapa: { evento: { path: "tipo" }, entity: "pedido", produto_id: "pid", produto_nome: "pn", email: "email" } },
    };
    const p = { tipo: "e".repeat(150), pedido: "T".repeat(400), pid: "9".repeat(250), pn: "P".repeat(600), email: "a@b.com" };
    const { banco, linhas } = bancoFalso();
    await receberVenda(banco, flix, entrega(p, flix), AGORA);
    expect(linhas[0]!.evento).toBe(`custom.${"e".repeat(93)}`);
    expect(linhas[0]!.entidade).toBe(`custom:${"T".repeat(293)}`);
    expect(linhas[0]!.pedido).toHaveLength(300);
    expect(linhas[0]!.produto_id).toHaveLength(200);
    expect(linhas[0]!.produto).toHaveLength(500);
  });

  it("corte por caractere: emoji na posição do corte não é partido ao meio", async () => {
    const flix: ConexaoDeVenda = {
      id: "c3",
      organizationId: "org-1",
      plataforma: "personalizada",
      config: { mapa: { evento: { fixo: "compra.aprovada" }, produto_nome: "pn", email: "email" } },
    };
    const { banco, linhas } = bancoFalso();
    await receberVenda(banco, flix, entrega({ pn: `${"P".repeat(499)}😀x`, email: "a@b.com" }, flix), AGORA);
    expect(linhas[0]!.produto).toBe(`${"P".repeat(499)}😀`);
  });

  it("personalizada com mapa e evento sem tradução: ignorado com motivo, não falhou", async () => {
    const comMapa: ConexaoDeVenda = {
      id: "c3",
      organizationId: "org-1",
      plataforma: "personalizada",
      config: { dispara: true, mapa: { evento: { path: "tipo", map: { pago: "compra.aprovada" } }, email: "email" } },
    };
    const { banco, linhas, fins } = bancoFalso();
    await receberVenda(banco, comMapa, entrega({ email: "a@b.com" }, comMapa), AGORA);
    expect(linhas[0]!.evento).toBeNull();
    expect(fins[0]![1]).toEqual({ status: "ignorado", motivo: "evento sem tradução: personalizado" });
    expect(banco.emitir).not.toHaveBeenCalled();
  });
});
