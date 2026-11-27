/**
 * A LISTA DE MODELOS DE UM NÚMERO — a mesma regra do envio.
 *
 * O sync do canal oficial grava a linha SEM número (é da WABA); filtrar a lista
 * só por `channel_session_id` devolvia zero modelos para o número oficial — o
 * defeito que a v1.45.0 fechou no envio e que a lista da campanha não pode reabrir.
 */
import { describe, expect, it } from "vitest";

import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_ZERNIO } from "./capabilities";
import { filtrarLinhasDaConexao, wabaDoOficial } from "./linha-do-espelho";

const L = (name: string, channel_session_id: string | null, waba_id: string | null, language = "pt_BR") => ({
  name,
  language,
  channel_session_id,
  waba_id,
});

const LINHAS = [
  L("boas_vindas", null, "WABA-1"),
  L("promo", null, "WABA-2"),
  L("orfa_de_parceiro", null, null),
  L("do_parceiro", "s-parceiro", null),
  L("boas_vindas", "s-oficial", "WABA-1"),
  L("boas_vindas", null, "WABA-1", "en_US"),
];

describe("filtrarLinhasDaConexao", () => {
  it("linha sem conexão da MESMA conta oficial entra; de outra conta e órfã de parceiro não", () => {
    const r = filtrarLinhasDaConexao(LINHAS, { channelSessionId: "s-outro-oficial", wabaDoOficial: "WABA-1" });
    expect(r.map((l) => `${l.name}/${l.language}`)).toEqual(["boas_vindas/pt_BR", "boas_vindas/en_US"]);
  });
  it("a linha do próprio número tem precedência sobre a da conta, no mesmo (nome, idioma)", () => {
    const r = filtrarLinhasDaConexao(LINHAS, { channelSessionId: "s-oficial", wabaDoOficial: "WABA-1" });
    expect(r).toEqual([L("boas_vindas", "s-oficial", "WABA-1"), L("boas_vindas", null, "WABA-1", "en_US")]);
  });
  it("número de parceiro vê só as linhas dele", () => {
    const r = filtrarLinhasDaConexao(LINHAS, { channelSessionId: "s-parceiro", wabaDoOficial: null });
    expect(r.map((l) => l.name)).toEqual(["do_parceiro"]);
  });
});

describe("wabaDoOficial", () => {
  it("só a sessão do canal oficial tem conta para a linha sem número", () => {
    expect(wabaDoOficial({ provider: CHANNEL_PROVIDER_META, meta_waba_id: "WABA-1" })).toBe("WABA-1");
    expect(wabaDoOficial({ provider: CHANNEL_PROVIDER_ZERNIO, meta_waba_id: "WABA-1" })).toBeNull();
    expect(wabaDoOficial({ provider: CHANNEL_PROVIDER_META, meta_waba_id: null })).toBeNull();
    expect(wabaDoOficial(null)).toBeNull();
  });
});
