import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ContatoExistente } from "@/lib/vendas/contato";
import { MOTIVO_DA_VENDA, SEIS_HORAS_MS, type FimDaVenda } from "@/lib/vendas/receber";
import { tentarDeNovo, type BancoDaTentativa, type ConexaoAtual, type LinhaGuardada } from "@/lib/vendas/reprocessar";

const fixture = (nome: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "vendas", `${nome}.json`), "utf8"));

const AGORA = new Date("2026-10-22T15:00:00Z");
const RECEBIDO = "2026-10-22T14:00:00.000Z";
const CONEXAO: ConexaoAtual = { id: "conexao-1", organizationId: "org-1", plataforma: "hotmart", config: { dispara: true }, ativa: true };
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000);

function linha(over: Partial<LinhaGuardada> = {}): LinhaGuardada {
  return {
    id: "ev-9",
    organization_id: "org-1",
    webhook_source_id: "conexao-1",
    plataforma: "hotmart",
    evento_original: "PURCHASE_APPROVED",
    evento: "compra.aprovada",
    chave_evento: "hm-evt-0001",
    teste: false,
    payload: fixture("hotmart_purchase_approved"),
    tentativas: 1,
    status: "recebido",
    recebido_em: RECEBIDO,
    ...over,
  };
}

function bancoFalso(over: Partial<BancoDaTentativa> = {}) {
  const fins: Array<[string, FimDaVenda]> = [];
  const banco: BancoDaTentativa = {
    registrar: vi.fn(async () => {
      throw new Error("a tentativa não registra a venda de novo");
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
    conexao: vi.fn(async (): Promise<ConexaoAtual | null> => CONEXAO),
    ...over,
  };
  return { banco, fins };
}

const quebraOEmit = () =>
  vi.fn(async () => {
    throw new Error("emit_event: caiu");
  });

describe("tentarDeNovo — a decisão a partir da linha guardada", () => {
  it("refaz só a decisão: não registra de novo, emite uma vez e vira processado", async () => {
    const { banco, fins } = bancoFalso();
    const fim = await tentarDeNovo(banco, linha(), AGORA);
    expect(fim).toEqual({ status: "processado", motivo: null, contactId: "contato-novo" });
    expect(banco.registrar).not.toHaveBeenCalled();
    expect(banco.marcarRecebimento).not.toHaveBeenCalled();
    expect(banco.conexao).toHaveBeenCalledWith("org-1", "conexao-1");
    expect(banco.emitir).toHaveBeenCalledTimes(1);
    expect(banco.emitir).toHaveBeenCalledWith(
      "org-1",
      "contato-novo",
      expect.objectContaining({ evento: "compra.aprovada", entidade: "hotmart:HP0001", sales_event_id: "ev-9" }),
      "venda:ev-9",
    );
    expect(fins).toEqual([["ev-9", { status: "processado", motivo: null, contactId: "contato-novo" }]]);
  });

  it("Kookie sem evento no corpo: o evento vem do evento original guardado (sem cabeçalho HTTP)", async () => {
    const kookie: ConexaoAtual = { ...CONEXAO, plataforma: "kookie" };
    const payload = fixture("kookie_venda_aprovada");
    delete payload.evento;
    const { banco } = bancoFalso({ conexao: vi.fn(async () => kookie) });
    await tentarDeNovo(banco, linha({ plataforma: "kookie", evento_original: "venda.aprovada", chave_evento: "kk-1", payload }), AGORA);
    expect(banco.emitir).toHaveBeenCalledWith(
      "org-1",
      "contato-novo",
      expect.objectContaining({ evento: "compra.aprovada", plataforma: "kookie" }),
      "venda:ev-9",
    );
  });

  it("conexão que foi para só registrando: vira ignorado e nada roda", async () => {
    const { banco, fins } = bancoFalso({ conexao: vi.fn(async () => ({ ...CONEXAO, config: { dispara: false } })) });
    await tentarDeNovo(banco, linha(), AGORA);
    expect(fins[0]![1]).toEqual({ status: "ignorado", motivo: MOTIVO_DA_VENDA.soRegistrando });
    expect(banco.criarContato).not.toHaveBeenCalled();
    expect(banco.emitir).not.toHaveBeenCalled();
  });

  it("conexão desligada ou que não existe mais: ignorado, conexão desligada", async () => {
    for (const conexao of [{ ...CONEXAO, ativa: false }, null]) {
      const { banco, fins } = bancoFalso({ conexao: vi.fn(async () => conexao) });
      await tentarDeNovo(banco, linha(), AGORA);
      expect(fins[0]![1]).toEqual({ status: "ignorado", motivo: MOTIVO_DA_VENDA.conexaoDesligada });
      expect(banco.emitir).not.toHaveBeenCalled();
    }
  });

  it("erro passageiro marca a próxima: 5 min, 30 min e 2 h; na 3ª falha fica de vez", async () => {
    for (const [tentativas, espera] of [
      [0, 5],
      [1, 30],
      [2, 120],
    ] as const) {
      const { banco, fins } = bancoFalso({ emitir: quebraOEmit() });
      await tentarDeNovo(banco, linha({ tentativas }), AGORA);
      expect(fins[0]![1]).toEqual({ status: "falhou", motivo: "emit_event: caiu", proximaTentativaEm: minutos(espera) });
    }
    const { banco, fins } = bancoFalso({ emitir: quebraOEmit() });
    await tentarDeNovo(banco, linha({ tentativas: 3 }), AGORA);
    expect(fins[0]![1]).toEqual({ status: "falhou", motivo: "emit_event: caiu" });
  });

  it("contato não criado é passageiro; personalizada sem mapa (configuração) não volta sozinha", async () => {
    const semContato = bancoFalso({ criarContato: vi.fn(async () => null) });
    await tentarDeNovo(semContato.banco, linha({ tentativas: 1 }), AGORA);
    expect(semContato.fins[0]![1]).toEqual({
      status: "falhou",
      motivo: MOTIVO_DA_VENDA.contatoNaoCriado,
      proximaTentativaEm: minutos(30),
    });

    const personalizada: ConexaoAtual = { ...CONEXAO, plataforma: "personalizada", config: { dispara: true } };
    const semMapa = bancoFalso({ conexao: vi.fn(async () => personalizada) });
    await tentarDeNovo(semMapa.banco, linha({ plataforma: "personalizada", evento: null, payload: { a: 1 } }), AGORA);
    expect(semMapa.fins[0]![1]).toEqual({ status: "falhou", motivo: MOTIVO_DA_VENDA.semMapa });
  });

  it("erro ao ler a conexão não some: falhou passageiro, com próxima tentativa", async () => {
    const { banco, fins } = bancoFalso({
      conexao: vi.fn(async () => {
        throw new Error("webhook_sources: timeout");
      }),
    });
    await tentarDeNovo(banco, linha({ tentativas: 1 }), AGORA);
    expect(fins[0]![1]).toEqual({ status: "falhou", motivo: "webhook_sources: timeout", proximaTentativaEm: minutos(30) });
  });

  it("linha sem dados (limpos): falhou de vez, sem próxima, sem tocar a conexão", async () => {
    const { banco, fins } = bancoFalso();
    await tentarDeNovo(banco, linha({ payload: null }), AGORA);
    expect(fins[0]![1]).toEqual({ status: "falhou", motivo: MOTIVO_DA_VENDA.semDados });
    expect(banco.conexao).not.toHaveBeenCalled();
  });

  it("fora das 24 h da chegada não marca próxima tentativa", async () => {
    const antiga = new Date(AGORA.getTime() - (23 * 60 + 50) * 60_000).toISOString();
    const { banco, fins } = bancoFalso({ emitir: quebraOEmit() });
    await tentarDeNovo(banco, linha({ tentativas: 1, recebido_em: antiga }), AGORA);
    expect(fins[0]![1]).toEqual({ status: "falhou", motivo: "emit_event: caiu" });
  });

  it("a janela de 6 h da recuperação conta da chegada da venda, não da tentativa", async () => {
    const { banco } = bancoFalso();
    await tentarDeNovo(
      banco,
      linha({ evento_original: "PURCHASE_OUT_OF_SHOPPING_CART", chave_evento: "hm-cart-0001", payload: fixture("hotmart_cart_abandonment") }),
      AGORA,
    );
    expect(banco.jaComprou).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", conexaoId: "conexao-1", desde: new Date(new Date(RECEBIDO).getTime() - SEIS_HORAS_MS) }),
    );
  });

  it("F1: linha que chegou sem tradução e agora traduz (mapa corrigido) completa as colunas derivadas, com os cortes da chegada", async () => {
    const mapa = { evento: { fixo: "compra.aprovada" }, entity: "pedido", produto_id: "pid", produto_nome: "pn", email: "email" };
    const personalizada: ConexaoAtual = { ...CONEXAO, plataforma: "personalizada", config: { dispara: true, mapa } };
    const { banco, fins } = bancoFalso({ conexao: vi.fn(async () => personalizada) });
    const longo = "🎁".repeat(600);
    const payload = { pedido: "P-77", pid: "prod-1", pn: longo, email: "Ana@Email.com" };
    const fim = await tentarDeNovo(banco, linha({ plataforma: "personalizada", evento: null, payload }), AGORA);
    expect(fim.colunas).toEqual({
      evento: "compra.aprovada",
      entidade: "custom:P-77",
      pedido: "P-77",
      produto_id: "prod-1",
      produto: "🎁".repeat(500),
      email: "ana@email.com",
      telefone: null,
      order_bump: false,
      venda: expect.objectContaining({ produto: "🎁".repeat(500) }),
    });
    expect(fins[0]![1]).toMatchObject({ status: "processado", colunas: fim.colunas });
    expect(banco.emitir).toHaveBeenCalledTimes(1);
  });

  it("F1: completa mesmo quando a decisão cai no meio; linha que já tinha evento não é reescrita", async () => {
    const mapa = { evento: { fixo: "compra.aprovada" }, email: "email" };
    const personalizada: ConexaoAtual = { ...CONEXAO, plataforma: "personalizada", config: { dispara: true, mapa } };
    const caiu = bancoFalso({ conexao: vi.fn(async () => personalizada), emitir: quebraOEmit() });
    await tentarDeNovo(caiu.banco, linha({ plataforma: "personalizada", evento: null, payload: { email: "a@b.com" } }), AGORA);
    expect(caiu.fins[0]![1]).toMatchObject({ status: "falhou", proximaTentativaEm: minutos(30), colunas: { evento: "compra.aprovada", email: "a@b.com" } });

    const jaTinha = bancoFalso({ conexao: vi.fn(async () => personalizada) });
    await tentarDeNovo(jaTinha.banco, linha({ plataforma: "personalizada", payload: { email: "a@b.com" } }), AGORA);
    expect(jaTinha.fins[0]![1]).not.toHaveProperty("colunas");
  });
});
