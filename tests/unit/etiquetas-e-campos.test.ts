/**
 * AS REGRAS COMPARTILHADAS DE ETIQUETA E CAMPO — e a `add_tag` no contato
 * passando a gravar a etiqueta como o contato guarda (Divergência D2 do plano).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/atendimento/origem-automacao", () => ({ originFromAutomationEvent: async () => null }));

import {
  MENSAGEM_ETIQUETA_LONGA_DO_CONTATO,
  alvoDaEscrita,
  anotarCampo,
  campoValido,
  etiquetaLongaDoContato,
  etiquetasDoDestino,
  removerEtiquetas,
} from "@/lib/automation/etiquetas-e-campos";
import { getAction } from "@/lib/automation/actions";
import type { ActionCtx } from "@/lib/automation/types";
import { problemaDasExpressoes } from "@/lib/campanhas/renderizador";
import { problemaNoTexto, renderizarValorDoCampo, valoresDoContexto } from "@/lib/campanhas/valores-do-contexto";
import { TAMANHO_MAXIMO_DA_TAG } from "@/lib/contacts/tag-normalizada";
import { actionSchema } from "@/lib/schemas/webhooks";

import "@/lib/automation/actions/add-tag";

const ORG = "11111111-1111-1111-1111-111111111111";
const QUARENTA_E_UM = "x".repeat(41);

function adminQueGuarda(resposta: { data: unknown; error: { message: string } | null }) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (nome === "emit_event") return { data: null, error: null };
      return resposta;
    },
  };
  return { admin: admin as never, chamadas };
}

describe("regras puras", () => {
  it("a mensagem de etiqueta longa cita o teto de verdade", () => {
    expect(TAMANHO_MAXIMO_DA_TAG).toBe(40);
    expect(MENSAGEM_ETIQUETA_LONGA_DO_CONTATO).toContain("40");
  });

  it("contato: normaliza (minúscula, sem espaço, sem repetida); card: só apara e tira repetida", () => {
    expect(etiquetasDoDestino(["VIP ", "vip", " Novo"], "contato")).toEqual(["vip", "novo"]);
    expect(etiquetasDoDestino(["VIP ", "VIP", " Novo"], "card")).toEqual(["VIP", "Novo"]);
  });

  it("etiqueta de 41 no contato é apontada; de 40 não", () => {
    expect(etiquetaLongaDoContato(["ok", QUARENTA_E_UM])).toBe(QUARENTA_E_UM);
    expect(etiquetaLongaDoContato(["x".repeat(40)])).toBeNull();
  });

  it("nome de campo: 1 a 60, sem ponto, sem nome de protótipo", () => {
    expect(campoValido("acesso_link_area")).toBe(true);
    expect(campoValido("")).toBe(false);
    expect(campoValido("a.b")).toBe(false);
    expect(campoValido("x".repeat(61))).toBe(false);
    expect(campoValido("__proto__")).toBe(false);
  });

  it("alvo: card manda; sem card, só cai no contato quando a opção pede; contato usa o do card", () => {
    const lead = { id: "L", contact_id: "C" };
    const contact = { id: "C2" };
    expect(alvoDaEscrita({ lead, contact }, "card", { cardSemNegocioUsaContato: true })).toMatchObject({ tabela: "crm_leads", id: "L" });
    expect(alvoDaEscrita({ contact }, "card", { cardSemNegocioUsaContato: true })).toMatchObject({ tabela: "contacts", id: "C2" });
    expect(alvoDaEscrita({ contact }, "card", { cardSemNegocioUsaContato: false })).toBeNull();
    expect(alvoDaEscrita({ lead, contact }, "contato", { cardSemNegocioUsaContato: false })).toMatchObject({ tabela: "contacts", id: "C" });
    expect(alvoDaEscrita({}, "contato", { cardSemNegocioUsaContato: false })).toBeNull();
  });

  it("valores do contexto: nome do cadastro, campos do contato e do card", () => {
    const v = valoresDoContexto({
      contact: { name: "Ana Souza", custom_fields: { link: "https://a" } },
      lead: { custom_fields: { plano: "ouro" } },
    });
    expect(v).toEqual({ nome: "Ana Souza", contato: { link: "https://a" }, lead: { plano: "ouro" } });
    expect(valoresDoContexto({}).lead).toBeNull();
  });

  it("render do valor: variável sem valor é FALTA, nunca texto pela metade", () => {
    const quando = { agora: new Date("2026-10-21T15:00:00Z"), fuso: "America/Sao_Paulo" };
    expect(renderizarValorDoCampo("{{primeiro_nome}}", { contact: { name: "Ana Souza" } }, quando)).toEqual({ ok: true, valor: "Ana" });
    expect(renderizarValorDoCampo("{{lead.plano}}", { contact: { name: "Ana" } }, quando)).toEqual({ ok: false, faltando: ["lead.plano"] });
  });

  it("problema nas variáveis: mal escrita e desconhecida", () => {
    expect(problemaDasExpressoes(["{{nome completo}}"])).toBe("variavel_mal_escrita");
    expect(problemaDasExpressoes(["{{sobrenome}}"])).toBe("variavel_desconhecida");
    expect(problemaDasExpressoes(["Oi {{primeiro_nome}}", "{{contato.x}}"])).toBeNull();
    expect(problemaNoTexto("{{sobrenome}}")).toMatch(/variável desconhecida/);
    expect(problemaNoTexto("Oi")).toBeNull();
  });
});

describe("escrita pelas RPCs da 9002", () => {
  it("tirar do contato chama fn_contato_remover_etiquetas com p_tags", async () => {
    const { admin, chamadas } = adminQueGuarda({ data: { tags: ["b"], removidas: ["a"] }, error: null });
    const r = await removerEtiquetas(admin, { organizationId: ORG, alvo: { tabela: "contacts", id: "C" }, tags: ["a"] });
    expect(r).toEqual({ ok: true, tags: ["b"], removidas: ["a"] });
    expect(chamadas[0]).toEqual({ nome: "fn_contato_remover_etiquetas", args: { p_org: ORG, p_contato: "C", p_tags: ["a"] } });
  });

  it("tirar do card chama fn_lead_remover_etiquetas; nulo do banco = sem_linha", async () => {
    const { admin, chamadas } = adminQueGuarda({ data: null, error: null });
    expect(await removerEtiquetas(admin, { organizationId: ORG, alvo: { tabela: "crm_leads", id: "L" }, tags: ["a"] })).toEqual({ ok: false, motivo: "sem_linha" });
    expect(chamadas[0]?.nome).toBe("fn_lead_remover_etiquetas");
  });

  it("gravar campo manda SÓ a chave pedida, no contato e no card", async () => {
    const contato = adminQueGuarda({ data: { x: "1", y: "2" }, error: null });
    expect(await anotarCampo(contato.admin, { organizationId: ORG, alvo: { tabela: "contacts", id: "C" }, campo: " y ", valor: "2" })).toEqual({ ok: true });
    expect(contato.chamadas[0]).toEqual({ nome: "fn_contato_anotar_campos", args: { p_org: ORG, p_contato: "C", p_campos: { y: "2" } } });
    const card = adminQueGuarda({ data: { y: "2" }, error: null });
    await anotarCampo(card.admin, { organizationId: ORG, alvo: { tabela: "crm_leads", id: "L" }, campo: "y", valor: "2" });
    expect(card.chamadas[0]).toEqual({ nome: "fn_lead_anotar_campos", args: { p_org: ORG, p_lead: "L", p_campos: { y: "2" } } });
  });

  it("erro do banco vira motivo erro com a mensagem", async () => {
    const { admin } = adminQueGuarda({ data: null, error: { message: "boom" } });
    expect(await anotarCampo(admin, { organizationId: ORG, alvo: { tabela: "contacts", id: "C" }, campo: "y", valor: "2" })).toEqual({ ok: false, motivo: "erro", erro: "boom" });
  });
});

describe("add_tag no contato (Divergência D2)", () => {
  const ctx = (admin: unknown, context: Record<string, unknown>) =>
    ({ admin, organizationId: ORG, ruleId: "r", ruleName: "r", event: {}, context, requestId: "q" }) as unknown as ActionCtx;

  it("⭐ add_tag no contato grava normalizado e recusa etiqueta de 41", async () => {
    const { admin, chamadas } = adminQueGuarda({ data: { tags: ["vip"], adicionadas: ["vip"] }, error: null });
    const acao = getAction("add_tag")!;
    await acao.execute(ctx(admin, { contact: { id: "C" } }), { tags: ["VIP "], destino: "contato" });
    expect(chamadas[0]).toMatchObject({ nome: "fn_contato_adicionar_etiquetas", args: { p_etiquetas: ["vip"] } });

    const longa = await acao.execute(ctx(admin, { contact: { id: "C" } }), { tags: [QUARENTA_E_UM], destino: "contato" });
    expect(longa).toMatchObject({ status: "failed", error: MENSAGEM_ETIQUETA_LONGA_DO_CONTATO });
  });

  it("controle: add_tag no CARD (e regra antiga sem destino) grava a etiqueta como veio", async () => {
    const { admin, chamadas } = adminQueGuarda({ data: { tags: ["VIP "], adicionadas: ["VIP "] }, error: null });
    await getAction("add_tag")!.execute(ctx(admin, { lead: { id: "L", contact_id: "C" } }), { tags: ["VIP "] });
    expect(chamadas[0]).toMatchObject({ nome: "fn_lead_adicionar_etiquetas", args: { p_etiquetas: ["VIP "] } });
  });

  it("R1: destino card SEM card cai no contato e a etiqueta sai normalizada; 41 é recusada", async () => {
    const { admin, chamadas } = adminQueGuarda({ data: { tags: ["vip"], adicionadas: ["vip"] }, error: null });
    const acao = getAction("add_tag")!;
    await acao.execute(ctx(admin, { contact: { id: "C" } }), { tags: ["VIP "], destino: "card" });
    expect(chamadas[0]).toMatchObject({ nome: "fn_contato_adicionar_etiquetas", args: { p_etiquetas: ["vip"] } });

    const sem = adminQueGuarda({ data: { tags: ["vip"], adicionadas: ["vip"] }, error: null });
    await acao.execute(ctx(sem.admin, { contact: { id: "C" } }), { tags: ["VIP "] });
    expect(sem.chamadas[0]).toMatchObject({ nome: "fn_contato_adicionar_etiquetas", args: { p_etiquetas: ["vip"] } });

    const longa = await acao.execute(ctx(admin, { contact: { id: "C" } }), { tags: [QUARENTA_E_UM] });
    expect(longa).toMatchObject({ status: "failed", error: MENSAGEM_ETIQUETA_LONGA_DO_CONTATO });
  });

  it("schema da regra: destino contato recusa 41; card aceita até 60", () => {
    expect(actionSchema.safeParse({ type: "add_tag", config: { tags: [QUARENTA_E_UM], destino: "contato" } }).success).toBe(false);
    expect(actionSchema.safeParse({ type: "add_tag", config: { tags: [QUARENTA_E_UM] } }).success).toBe(true);
  });
});
