/**
 * A TELA DIZ A VERDADE (caminho 1, item 4): a última saída que CHEGOU à Meta foi
 * recusada por permissão → "Recebe, mas não tem autorização para mandar".
 */
import { describe, expect, it } from "vitest";

import { ultimaRecusaPorAutorizacao } from "@/lib/channels/meta/sem-autorizacao";

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "22222222-2222-4222-8222-222222222222";
const RECUSA_10 = "meta_10: (subcode 2593181; fbtrace AbC) Application does not have permission for this action";

function admin(linhas: unknown[] | null, erro: { message: string } | null = null) {
  const filtros: Array<[string, unknown]> = [];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
    in: () => q,
    gte: (c: string, v: unknown) => (filtros.push([c, v]), q),
    order: () => q,
    limit: () => Promise.resolve({ data: linhas, error: erro }),
  };
  return { db: { from: () => q } as never, filtros };
}

const saida = (status: string, error_message: string | null, created_at: string, error_code: string | null = "meta_error") => ({
  status,
  error_code: status === "failed" ? error_code : null,
  error_message,
  created_at,
});

describe("ultimaRecusaPorAutorizacao", () => {
  it("⭐ a última que chegou à Meta foi recusada por 10: devolve o erro inteiro e quando", async () => {
    const { db, filtros } = admin([saida("failed", RECUSA_10, "2026-10-22T15:00:00Z")]);
    expect(await ultimaRecusaPorAutorizacao(db, { organizationId: ORG, channelSessionId: CANAL })).toEqual({
      detalhe: RECUSA_10,
      em: "2026-10-22T15:00:00Z",
    });
    expect(filtros).toContainEqual(["organization_id", ORG]);
    expect(filtros).toContainEqual(["channel_session_id", CANAL]);
    expect(filtros).toContainEqual(["direction", "outbound"]);
    // F7: só os últimos 7 dias — recusa antiga não vira selo eterno.
    expect(filtros.some(([c]) => c === "created_at")).toBe(true);
  });

  it("pula as barradas antes da Meta (modo de teste, interruptor)", async () => {
    const { db } = admin([
      saida("failed", "Resposta automática desligada neste número…", "2026-10-22T16:00:00Z", "resposta_automatica_desligada"),
      saida("failed", "Envio automático bloqueado pelo modo de teste do canal.", "2026-10-22T15:30:00Z", "pre_go_live"),
      saida("failed", "meta_200: Permissions error", "2026-10-22T15:00:00Z"),
    ]);
    expect((await ultimaRecusaPorAutorizacao(db, { organizationId: ORG, channelSessionId: CANAL }))?.em).toBe(
      "2026-10-22T15:00:00Z",
    );
  });

  it("depois de um envio que saiu, ou recusa de outro tipo: nada", async () => {
    expect(
      await ultimaRecusaPorAutorizacao(admin([saida("sent", null, "2026-10-22T16:00:00Z"), saida("failed", RECUSA_10, "2026-10-22T15:00:00Z")]).db, {
        organizationId: ORG,
        channelSessionId: CANAL,
      }),
    ).toBeNull();
    expect(
      await ultimaRecusaPorAutorizacao(admin([saida("failed", "meta_131047: x", "2026-10-22T16:00:00Z")]).db, {
        organizationId: ORG,
        channelSessionId: CANAL,
      }),
    ).toBeNull();
  });

  it("leitura que falha: nada (a tela mostra o status de sempre)", async () => {
    expect(await ultimaRecusaPorAutorizacao(admin(null, { message: "boom" }).db, { organizationId: ORG, channelSessionId: CANAL })).toBeNull();
  });
});
