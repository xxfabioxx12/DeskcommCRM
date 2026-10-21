import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  conferirAssinatura,
  conferirHotmart,
  conferirKiwify,
  conferirKookie,
  conferirPersonalizada,
  type EntradaDaAssinatura,
} from "@/lib/vendas/assinatura";

const AGORA = new Date("2026-10-21T12:00:00Z");
const CORPO = '{"checkout_link":"https://pay.kiwify.com.br/abc123","name":"Leo"}';

function entrada(
  over: { corpo?: string; segredo?: string | null; headers?: Record<string, string>; params?: Record<string, string>; agora?: Date } = {},
): EntradaDaAssinatura {
  const corpo = over.corpo ?? CORPO;
  const h = new Headers(over.headers ?? {});
  const q = new URLSearchParams(over.params ?? {});
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(corpo) as Record<string, unknown>;
  } catch {
    payload = null;
  }
  return {
    corpo,
    payload,
    cabecalho: (n) => h.get(n),
    query: (n) => q.get(n),
    segredo: over.segredo === undefined ? "segredo" : over.segredo,
    agora: over.agora ?? AGORA,
  };
}

const hmac = (alg: "sha1" | "sha256", segredo: string, dado: string) => createHmac(alg, segredo).update(dado).digest("hex");

describe("Hotmart — X-HOTMART-HOTTOK igual ao segredo", () => {
  it("válido passa; errado, ausente e sem segredo salvo são recusados", () => {
    expect(conferirHotmart(entrada({ headers: { "X-HOTMART-HOTTOK": "segredo" } }))).toBeNull();
    expect(conferirHotmart(entrada({ headers: { "X-HOTMART-HOTTOK": "outro" } }))).toBe("hottok não confere");
    expect(conferirHotmart(entrada())).toBe("cabeçalho X-HOTMART-HOTTOK ausente");
    expect(conferirHotmart(entrada({ segredo: null, headers: { "X-HOTMART-HOTTOK": "x" } }))).toBe("conexão sem hottok salvo");
  });
});

describe("Kiwify — ?signature= HMAC-SHA1 do corpo", () => {
  it("assinatura do corpo bruto passa", () => {
    expect(conferirKiwify(entrada({ params: { signature: hmac("sha1", "segredo", CORPO) } }))).toBeNull();
  });

  it("assinatura do JSON re-serializado passa (barras escapadas no corpo bruto)", () => {
    const comBarrasEscapadas = '{"checkout_link":"https:\\/\\/pay.kiwify.com.br\\/abc123","name":"Leo"}';
    const assinatura = hmac("sha1", "segredo", JSON.stringify(JSON.parse(comBarrasEscapadas)));
    expect(conferirKiwify(entrada({ corpo: comBarrasEscapadas, params: { signature: assinatura } }))).toBeNull();
  });

  it("inválida, ausente e sem segredo são recusadas", () => {
    expect(conferirKiwify(entrada({ params: { signature: "abc" } }))).toBe("assinatura não confere");
    expect(conferirKiwify(entrada())).toBe("parâmetro signature ausente");
    expect(conferirKiwify(entrada({ segredo: null, params: { signature: "abc" } }))).toBe("conexão sem chave de assinatura salva");
  });
});

describe("Kookie — X-Webhook-Signature = HMAC-SHA256(timestamp.corpo), 15 min", () => {
  const ts = "2026-10-21T12:00:00+00:00";
  const assinada = (quando: string, corpo = CORPO, segredo = "segredo") => ({
    "X-Webhook-Signature": hmac("sha256", segredo, `${quando}.${corpo}`),
    "X-Webhook-Timestamp": quando,
  });

  it("válida passa", () => {
    expect(conferirKookie(entrada({ headers: assinada(ts) }))).toBeNull();
  });

  it("segredo errado e corpo alterado falham", () => {
    expect(conferirKookie(entrada({ headers: assinada(ts, CORPO, "outro") }))).toBe("assinatura não confere");
    expect(conferirKookie(entrada({ corpo: '{"x":1}', headers: assinada(ts) }))).toBe("assinatura não confere");
  });

  it("fora da tolerância de 15 minutos falha", () => {
    const antigo = "2026-10-21T11:44:00+00:00";
    expect(conferirKookie(entrada({ headers: assinada(antigo) }))).toBe("assinatura fora da janela de 15 minutos");
    expect(conferirKookie(entrada({ headers: assinada("2026-10-21T11:46:00+00:00") }))).toBeNull();
  });

  it("cabeçalhos ou segredo ausentes falham", () => {
    expect(conferirKookie(entrada({ headers: { "X-Webhook-Timestamp": ts } }))).toBe("cabeçalho de assinatura ausente");
    expect(conferirKookie(entrada({ segredo: "", headers: assinada(ts) }))).toBe("conexão sem segredo salvo");
    expect(conferirKookie(entrada({ headers: { "X-Webhook-Signature": "a", "X-Webhook-Timestamp": "ontem" } }))).toBe(
      "horário da assinatura inválido",
    );
  });
});

describe("Personalizada — nenhuma, header_igual ou stripe_t_v1", () => {
  it("modo nenhuma passa sem segredo", () => {
    expect(conferirPersonalizada(entrada({ segredo: null }), { modo: "nenhuma" })).toBeNull();
    expect(conferirPersonalizada(entrada({ segredo: null }), undefined)).toBeNull();
  });

  it("header_igual: cabeçalho escolhido ou o padrão X-Webhook-Secret", () => {
    const seg = { modo: "header_igual" as const, header: "X-Minha-Chave" };
    expect(conferirPersonalizada(entrada({ headers: { "X-Minha-Chave": "segredo" } }), seg)).toBeNull();
    expect(conferirPersonalizada(entrada({ headers: { "X-Minha-Chave": "errada" } }), seg)).toBe(
      "valor do cabeçalho X-Minha-Chave não confere",
    );
    expect(conferirPersonalizada(entrada({ headers: { "X-Webhook-Secret": "segredo" } }), { modo: "header_igual" })).toBeNull();
    expect(conferirPersonalizada(entrada(), { modo: "header_igual" })).toBe("cabeçalho X-Webhook-Secret ausente");
    expect(conferirPersonalizada(entrada({ segredo: null }), { modo: "header_igual" })).toBe(
      "o modo de validação exige uma chave secreta, mas nenhuma foi salva na conexão",
    );
  });

  it("stripe_t_v1: v1 extra de rotação, janela e corpo adulterado", () => {
    const seg = { modo: "stripe_t_v1" as const, header: "X-Kookie-Signature", tolerancia_s: 300 };
    const t = String(Math.floor(AGORA.getTime() / 1000));
    const v1 = hmac("sha256", "segredo", `${t}.${CORPO}`);
    expect(conferirPersonalizada(entrada({ headers: { "X-Kookie-Signature": `t=${t},v1=deadbeef,v1=${v1}` } }), seg)).toBeNull();
    const antigo = String(Number(t) - 3600);
    expect(
      conferirPersonalizada(
        entrada({ headers: { "X-Kookie-Signature": `t=${antigo},v1=${hmac("sha256", "segredo", `${antigo}.${CORPO}`)}` } }),
        seg,
      ),
    ).toBe("assinatura fora da janela de 300s");
    expect(conferirPersonalizada(entrada({ corpo: '{"event":"outro"}', headers: { "X-Kookie-Signature": `t=${t},v1=${v1}` } }), seg)).toBe(
      "assinatura não confere com a chave secreta salva",
    );
    expect(conferirPersonalizada(entrada({ headers: { "X-Kookie-Signature": "v1=abc" } }), seg)).toBe(
      "assinatura fora do formato t=<timestamp>,v1=<hash>",
    );
  });
});

it("conferirAssinatura escolhe pela plataforma", () => {
  expect(conferirAssinatura("hotmart", entrada({ headers: { "X-HOTMART-HOTTOK": "segredo" } }), {})).toBeNull();
  expect(conferirAssinatura("personalizada", entrada({ segredo: null }), {})).toBeNull();
  expect(conferirAssinatura("kiwify", entrada(), {})).toBe("parâmetro signature ausente");
});

it("plataforma fora da lista (gravada torta) é recusada, não aceita calada", () => {
  expect(conferirAssinatura("lead_capture" as never, entrada(), {})).toBe("plataforma desconhecida");
});
