/**
 * Parte 3 — o texto de reserva (`{{primeiro_nome|"aluno"}}`) só é entendido pelo
 * renderizador da campanha (passo "Mensagem", lacunas, "Gravar campo"). Onde ele
 * não é entendido — envio antigo do fluxo (modo texto e modelos de mensagem),
 * "Enviar mensagem no WhatsApp" e "Enviar e-mail" da regra, respostas rápidas do
 * Inbox — sairia literal para o cliente. Por isso esses caminhos recusam no salvar.
 */
import { describe, expect, it } from "vitest";

import { FRASE_DA_RESERVA_FORA_DO_LUGAR, temTextoDeReserva } from "@/lib/campanhas/valores-do-contexto";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import { createTemplateSchema, updateTemplateSchema } from "@/lib/schemas/templates";
import { actionSchema } from "@/lib/schemas/webhooks";

const RESERVA = '{{primeiro_nome|"aluno"}}';
const CANAL = "11111111-1111-4111-8111-111111111111";

const mensagensDe = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.message);

describe("reserva fora do lugar", () => {
  it("detecta `{{…|` e nada mais", () => {
    expect(temTextoDeReserva(RESERVA)).toBe(true);
    expect(temTextoDeReserva("Oi {{ nome |aluno}}")).toBe(true);
    expect(temTextoDeReserva("Oi {{primeiro_nome}}, plano A | plano B")).toBe(false);
    expect(temTextoDeReserva("Oi {{primeiro_nome}}")).toBe(false);
  });

  it("a frase tem espanhol", () => {
    expect(DICIONARIO[FRASE_DA_RESERVA_FORA_DO_LUGAR]?.es).toBeTruthy();
  });

  it("regra › Enviar mensagem no WhatsApp: recusa a reserva com a frase; sem `|` continua aceito", () => {
    const parse = (template: string) =>
      actionSchema.safeParse({ type: "send_whatsapp_message", config: { channel_session_id: CANAL, template } });
    expect(mensagensDe(parse(`Oi ${RESERVA}`))).toEqual([FRASE_DA_RESERVA_FORA_DO_LUGAR]);
    expect(parse("Oi {{primeiro_nome}}").success).toBe(true);
  });

  it("regra › Enviar e-mail: recusa a reserva no assunto e no corpo", () => {
    const parse = (assunto: string, corpo: string) =>
      actionSchema.safeParse({ type: "send_email", config: { destinatario: "contato", assunto, corpo } });
    expect(mensagensDe(parse(RESERVA, "corpo"))).toEqual([FRASE_DA_RESERVA_FORA_DO_LUGAR]);
    expect(mensagensDe(parse("assunto", RESERVA))).toEqual([FRASE_DA_RESERVA_FORA_DO_LUGAR]);
    expect(parse("Oi {{nome}}", "Corpo {{lead.title}}").success).toBe(true);
  });

  it("modelo de mensagem (Inbox e fluxo antigo): recusa na criação e na edição", () => {
    expect(mensagensDe(createTemplateSchema.safeParse({ title: "t", body: `Oi ${RESERVA}` }))).toEqual([FRASE_DA_RESERVA_FORA_DO_LUGAR]);
    expect(mensagensDe(updateTemplateSchema.safeParse({ body: `Oi ${RESERVA}` }))).toEqual([FRASE_DA_RESERVA_FORA_DO_LUGAR]);
    expect(createTemplateSchema.safeParse({ title: "t", body: "Oi {{nome}}" }).success).toBe(true);
    expect(updateTemplateSchema.safeParse({ title: "só o título" }).success).toBe(true);
  });

  it("fluxo › passo antigo de texto: a publicação recusa; o passo Mensagem aceita", () => {
    const grafo = (config: Record<string, unknown>) =>
      flowGraphSchema.parse({
        nodes: [
          { id: "t", type: "trigger", label: "início", position: { x: 0, y: 0 }, config: {} },
          { id: "m", type: "action", label: "Manda", position: { x: 1, y: 0 }, config },
          { id: "f", type: "end", label: "fim", position: { x: 2, y: 0 }, config: { outcome: "converted" } },
        ],
        edges: [
          { id: "a", source: "t", target: "m", condition: { type: "always" } },
          { id: "b", source: "m", target: "f", condition: { type: "always" } },
        ],
      });
    const antigo = validateFlowForPublish(grafo({ mode: "text", body: `Oi ${RESERVA}` }));
    expect(antigo.ok).toBe(false);
    if (!antigo.ok) {
      expect(antigo.errors).toEqual([
        { node_id: "m", code: "variavel_desconhecida", message: `A caixa "Manda": ${FRASE_DA_RESERVA_FORA_DO_LUGAR}` },
      ]);
    }
    expect(validateFlowForPublish(grafo({ mode: "text", body: "Oi {{primeiro_nome}}" })).ok).toBe(true);
    expect(validateFlowForPublish(grafo({ mode: "mensagem", texto: { body: `Oi ${RESERVA}` } })).ok).toBe(true);
  });
});
