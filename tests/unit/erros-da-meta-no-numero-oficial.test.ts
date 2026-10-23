/**
 * ERROS DA META NO NÚMERO OFICIAL (caminho 1, item 2).
 *
 * O 10/2593181 chegava cru ("meta_10: Application does not have permission") e
 * jogava fora subcódigo e fbtrace, que é o que o suporte da Meta pede. E a
 * campanha só parava depois de 5 falhas seguidas.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) as never }));
vi.mock("@/lib/channels/meta/credentials", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveMetaCreds: vi.fn(async () => ({ phoneNumberId: "845199182001279", token: "tok", graphVersion: "v23.0", source: "session" })),
}));

import { metaCloudAdapter } from "@/lib/channels/adapters/meta-cloud";
import { textoDoErroDaGraph } from "@/lib/channels/meta/erro-da-graph";
import {
  FRASES_PARA_OPERADOR,
  acessoNegadoPelaMeta,
  codigoDaPlataforma,
  conversaComOutroApp,
  explicarFalhaDoEnvio,
  falhaDeTemplate,
  problemaNaContaDoNumero,
  semAutorizacaoParaMandar,
} from "@/lib/channels/meta/erros-para-operador";
import { sendTemplate } from "@/lib/channels/meta/send-template";
import { falhaDoEnvioParaACampanha } from "@/lib/campanhas/envio-por-template";
import { TEXTO_DA_FALHA_DA_CAMPANHA, ehFalhaQuePausaACampanha } from "@/lib/campanhas/tipos";
import { DICIONARIO } from "@/lib/i18n/dicionario";

const ERRO_10 = {
  code: 10,
  error_subcode: 2593181,
  message: "Application does not have permission for this action",
  fbtrace_id: "AbC_12-x",
};
const TEXTO_10 = "(subcode 2593181; fbtrace AbC_12-x) Application does not have permission for this action";

afterEach(() => vi.unstubAllGlobals());

describe("textoDoErroDaGraph", () => {
  it("⭐ subcódigo e fbtrace vêm PRIMEIRO (sobrevivem ao corte de 300)", () => {
    expect(textoDoErroDaGraph(ERRO_10, 400)).toBe(TEXTO_10);
  });

  it("⭐ a mensagem da Meta não guarda telefone nem e-mail, e é cortada em 160", () => {
    const t = textoDoErroDaGraph(
      { ...ERRO_10, error_user_msg: "Fale com +55 51 98149-5911 ou fabio@nodz.com.br para liberar" },
      400,
    );
    expect(t).toBe(`${TEXTO_10} · Meta: "Fale com ••• ou ••• para liberar"`);
    expect(t).not.toMatch(/98149|nodz\.com/);
    const longa = textoDoErroDaGraph({ code: 10, message: "x", error_user_msg: "a".repeat(400) }, 400);
    expect(longa.length).toBeLessThan(200);
  });

  it("fbtrace fora do formato e subcódigo não inteiro não entram", () => {
    expect(textoDoErroDaGraph({ code: 10, message: "x", fbtrace_id: "<script>", error_subcode: 1.5 }, 400)).toBe("x");
  });

  it("details continua mandando (diz QUAL parâmetro); sem corpo, o HTTP", () => {
    expect(textoDoErroDaGraph({ code: 132000, message: "x", error_data: { details: "param 2" } }, 400)).toBe("param 2");
    expect(textoDoErroDaGraph(undefined, 500)).toBe("http_500");
  });
});

describe("o envio guarda o texto inteiro", () => {
  const recusa = () =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, statusText: "", json: async () => ({ error: ERRO_10 }) })));

  it("adapter: meta_10 com subcódigo e fbtrace", async () => {
    recusa();
    await expect(
      metaCloudAdapter.send({ organizationId: "o", sessionRef: "845199182001279", to: "5551999990000", kind: "text", body: "oi" } as never),
    ).rejects.toThrow(`meta_10: ${TEXTO_10}`);
  });

  it("template: a mensagem do api_error leva o mesmo texto", async () => {
    recusa();
    const r = await sendTemplate({
      phoneNumberId: "845199182001279",
      token: "tok",
      graphVersion: "v23.0",
      to: "5551999990000",
      binding: { name: "promo", language: "pt_BR", contractHash: "h1", values: {} },
      current: { name: "promo", language: "pt_BR", contractHash: "h1", status: "APPROVED", components: [{ type: "BODY", text: "Olá" }] },
    });
    expect(r).toEqual({ sent: false, reason: "api_error", code: 10, message: TEXTO_10 });
  });
});

describe("tradução dos códigos novos", () => {
  it.each([
    ["10", "Sem autorização da Meta para mandar por este número"],
    ["200", "Sem autorização da Meta para mandar por este número"],
    ["190", "A chave de acesso da Meta venceu ou foi trocada: conecte o número de novo"],
    ["131070", "A conversa está com o ManyChat"],
  ])("%s → frase traduzível, pelo webhook e pelo envio síncrono", (codigo, frase) => {
    expect(explicarFalhaDoEnvio(codigo, "x")).toEqual({ frase, traduzivel: true, codigo });
    expect(explicarFalhaDoEnvio("meta_error", `meta_${codigo}: ${TEXTO_10}`)?.frase).toBe(frase);
    expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
  });

  it("código de 1 e 2 dígitos sai do texto; os pré-voos continuam sem código", () => {
    expect(codigoDaPlataforma("meta_error", "meta_10: x")).toBe("10");
    expect(codigoDaPlataforma("10", null)).toBe("10");
    expect(codigoDaPlataforma("send_failed", "template_stale: x mudou")).toBeNull();
    expect(codigoDaPlataforma("valores_faltando", "Faltam valores do template para esta pessoa: x")).toBeNull();
  });

  it("⭐ 1–2 dígitos só valem nos prefixos meta_ e datafy_ (QR Code não muda)", () => {
    expect(codigoDaPlataforma("datafy_error", "datafy_10: x")).toBe("10");
    expect(codigoDaPlataforma("send_failed", "waha_10: x")).toBeNull();
    expect(codigoDaPlataforma("send_failed", "zernio_42: x")).toBeNull();
    expect(codigoDaPlataforma("send_failed", "waha_500: x")).toBe("500");
  });

  it("toda frase do tradutor segue com espanhol", () => {
    for (const frase of FRASES_PARA_OPERADOR) expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
  });
});

describe("as perguntas que a campanha, a saúde e o motor fazem", () => {
  it("semAutorizacaoParaMandar: 10 e 200 (a saúde); 190 não (o vigia já pega)", () => {
    expect(semAutorizacaoParaMandar("meta_error", "meta_10: x")).toBe(true);
    expect(semAutorizacaoParaMandar("200", null)).toBe(true);
    expect(semAutorizacaoParaMandar("190", null)).toBe(false);
    expect(semAutorizacaoParaMandar("131026", null)).toBe(false);
  });

  it("acessoNegadoPelaMeta: 10, 200 e 190; 131005 fica fora (Divergência D6)", () => {
    for (const c of ["10", "200", "190"]) expect(acessoNegadoPelaMeta(c, null), c).toBe(true);
    expect(acessoNegadoPelaMeta("131005", null)).toBe(false);
    expect(acessoNegadoPelaMeta("131070", null)).toBe(false);
  });

  it("conversaComOutroApp: só o 131070", () => {
    expect(conversaComOutroApp("meta_error", "meta_131070: owned by another app")).toBe(true);
    expect(conversaComOutroApp("131070", null)).toBe(true);
    expect(conversaComOutroApp("meta_error", "meta_131047: x")).toBe(false);
  });

  it("permissão não é falha do template nem da conta (cada pausa tem motivo próprio)", () => {
    expect(falhaDeTemplate("meta_error", "meta_10: x")).toBeNull();
    expect(problemaNaContaDoNumero("meta_error", "meta_10: x")).toBe(false);
  });
});

describe("⭐ campanha pausa na 1ª falha de permissão", () => {
  it.each(["10", "200", "190"])("meta_%s → sem_autorizacao", (codigo) => {
    expect(falhaDoEnvioParaACampanha("meta_error", `meta_${codigo}: ${TEXTO_10}`)).toBe("sem_autorizacao");
  });

  it("131070 e falha da pessoa não pausam", () => {
    expect(falhaDoEnvioParaACampanha("meta_error", "meta_131070: x")).toBeNull();
    expect(falhaDoEnvioParaACampanha("meta_error", "meta_131026: x")).toBeNull();
  });

  it("o motivo tem frase com espanhol e é motivo de pausa", () => {
    expect(ehFalhaQuePausaACampanha("sem_autorizacao")).toBe(true);
    expect(DICIONARIO[TEXTO_DA_FALHA_DA_CAMPANHA.sem_autorizacao]?.es).toBeTruthy();
  });
});
