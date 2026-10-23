/**
 * 131070 NÃO É REPETIDO, NÃO ABRE CASO E NÃO PAUSA A IA (caminho 1, item 2; D9).
 *
 * O turno da IA tratava toda falha como "tente de novo": re-rodava o turno inteiro
 * (modelo incluso) até max_attempts e então abria o job_dead crítico na Central.
 */
import { describe, expect, it, vi } from "vitest";

import {
  EnvioSemNovaTentativaError,
  envioSemNovaTentativa,
  erroDoEnvioQueFalhou,
} from "@/lib/agent-engine/agent/falha-do-envio";
import { reportarEnvio } from "@/lib/automation/desfecho-do-envio";
import { sendWithLedger } from "@/lib/agent-engine/edge/crm/send-ledger";
import { RESPOSTA_AUTOMATICA_DESLIGADA } from "@/lib/channels/responde-sozinho";

const MENSAGEM = "envio marcado como failed pelo CRM — run re-tentado pela fila";
const falha = (codigo: string | null, detalhe: string | null) =>
  ({ kind: "failed", idempotencyKey: "k", messageId: "m", erro: { codigo, detalhe } }) as const;

describe("envioSemNovaTentativa", () => {
  it("131070 e interruptor desligado: não repete", () => {
    expect(envioSemNovaTentativa("meta_error", "meta_131070: owned by another app")).toBe(true);
    expect(envioSemNovaTentativa(RESPOSTA_AUTOMATICA_DESLIGADA, "Resposta automática desligada…")).toBe(true);
  });
  it("o resto continua com nova tentativa", () => {
    expect(envioSemNovaTentativa("meta_error", "meta_131047: x")).toBe(false);
    expect(envioSemNovaTentativa("meta_error", "meta_10: x")).toBe(false);
    expect(envioSemNovaTentativa(null, null)).toBe(false);
  });
});

describe("erroDoEnvioQueFalhou", () => {
  it("⭐ só 131070: erro terminal (o worker cancela sem retry e sem job_dead)", () => {
    const e = erroDoEnvioQueFalhou([falha("meta_error", "meta_131070: x")], MENSAGEM);
    expect(e).toBeInstanceOf(EnvioSemNovaTentativaError);
    expect((e as { terminal?: unknown }).terminal).toBe(true);
  });
  it("misturado com falha comum, ou sem o erro: o de sempre (a fila tenta de novo)", () => {
    const e = erroDoEnvioQueFalhou([falha("meta_error", "meta_131070: x"), falha("meta_error", "meta_131047: y")], MENSAGEM);
    expect(e).not.toBeInstanceOf(EnvioSemNovaTentativaError);
    expect(e.message).toBe(MENSAGEM);
    expect(erroDoEnvioQueFalhou([{ kind: "failed", idempotencyKey: "k", messageId: null }], MENSAGEM).message).toBe(MENSAGEM);
  });
});

describe("o ledger carrega o erro da mensagem até o motor", () => {
  it("failed leva código e detalhe", async () => {
    const store = {
      create: vi.fn(async () => "ledger-novo"),
      find: vi.fn(),
      rotate: vi.fn(),
      message: vi.fn(),
      update: vi.fn(async () => {}),
    };
    const r = await sendWithLedger(
      store as never,
      { tenantId: "org", leadId: "c", jobId: "j", seq: 1, body: "oi" },
      async (_k, id) => ({ id, status: "failed", error_code: "meta_error", error_message: "meta_131070: x" }),
    );
    expect(r).toMatchObject({ kind: "failed", erro: { codigo: "meta_error", detalhe: "meta_131070: x" } });
  });
});

describe("F5: regra de automação não abre alerta crítico para o esperado", () => {
  const admin = () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));
    return { admin: { from } as never, insert };
  };
  const ctx = (a: never) => ({ admin: a, organizationId: "org", ruleName: "r" });
  it.each([
    ["interruptor desligado", { id: "m", status: "failed", error_code: RESPOSTA_AUTOMATICA_DESLIGADA, error_message: "x" }],
    ["131070", { id: "m", status: "failed", error_code: "meta_error", error_message: "meta_131070: x" }],
  ])("%s: o run falha, mas nada entra na Central", async (_n, mensagem) => {
    const { admin: a, insert } = admin();
    const d = await reportarEnvio(ctx(a), "send_whatsapp_message", mensagem, "conv");
    expect(d.status).toBe("failed");
    expect(insert).not.toHaveBeenCalled();
  });
  it("falha comum continua abrindo o alerta", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const q = { select: () => q, eq: () => q, gte: () => q, limit: async () => ({ data: [], error: null }), insert };
    const d = await reportarEnvio(ctx({ from: () => q } as never), "send_whatsapp_message", { id: "m", status: "failed", error_code: "meta_error", error_message: "meta_131047: x" }, "conv");
    expect(d.status).toBe("failed");
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
