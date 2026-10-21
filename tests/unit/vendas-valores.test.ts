import { describe, expect, it } from "vitest";

import {
  CAMPOS_DA_VENDA,
  EVENTOS_DA_VENDA,
  EVENTOS_DE_RECUPERACAO,
  ROTULO_DO_EVENTO,
  ehEventoPadrao,
  ehPlataformaDeVenda,
  eventoDoFiltroValido,
  eventoValido,
} from "@/lib/vendas/eventos";
import {
  emailNormalizado,
  extrairTexto,
  lerCaminho,
  reaisEmCentavos,
  slug,
  texto,
  textoEmCentavos,
  valorEmReais,
  verdadeiroDoPhp,
} from "@/lib/vendas/valores";

describe("evento padrão (CanonicalEvents.php do integrador)", () => {
  it("os 14 da spec, cada um com rótulo", () => {
    expect(EVENTOS_DA_VENDA).toHaveLength(14);
    for (const e of EVENTOS_DA_VENDA) expect(ROTULO_DO_EVENTO[e], e).toBeTruthy();
    expect([...EVENTOS_DE_RECUPERACAO].sort()).toEqual(["carrinho.abandonado", "compra.boleto_gerado", "compra.pix_gerado"]);
  });

  it("custom.*, acesso.* e lead.capturado só na personalizada (D9)", () => {
    expect(eventoValido("custom.lesson_completed", "personalizada")).toBe(true);
    expect(eventoValido("acesso.revogado", "personalizada")).toBe(true);
    expect(eventoValido("lead.capturado", "personalizada")).toBe(true);
    expect(eventoValido("custom.x", "hotmart")).toBe(false);
    expect(eventoValido("compra.aprovada", "kiwify")).toBe(true);
    expect(eventoValido("Compra.Aprovada", "personalizada")).toBe(false);
    expect(eventoDoFiltroValido("custom.lesson_completed")).toBe(true);
    expect(eventoDoFiltroValido("compra.qualquer")).toBe(false);
  });

  it("guardas de tipo e os campos fixos de venda.*", () => {
    expect(ehPlataformaDeVenda("kookie")).toBe(true);
    expect(ehPlataformaDeVenda("lead_capture")).toBe(false);
    expect(ehEventoPadrao("carrinho.abandonado")).toBe(true);
    expect(ehEventoPadrao("custom.x")).toBe(false);
    expect(CAMPOS_DA_VENDA).toContain("checkout_url");
    expect(CAMPOS_DA_VENDA).not.toContain("extra");
  });
});

describe("valores do payload (MapaCampos.php do integrador)", () => {
  const payload = {
    data: { student: { email: " Aluno@Email.com ", phone: 11988887777, ativo: false }, items: [{ id: "a" }] },
  };

  it("caminho com ponto, índice de lista e só propriedade própria", () => {
    expect(lerCaminho(payload, "data.items.0.id")).toBe("a");
    expect(lerCaminho(payload, "data.__proto__")).toBeUndefined();
    expect(lerCaminho(payload, "data.student.constructor")).toBeUndefined();
    expect(lerCaminho(payload, "data.nada.mais")).toBeUndefined();
  });

  it("extrairTexto: o primeiro escalar não vazio, aparado; objeto e falso não contam", () => {
    expect(extrairTexto(payload, "data.student.email")).toBe("Aluno@Email.com");
    expect(extrairTexto(payload, ["data.nada", "data.student.phone"])).toBe("11988887777");
    expect(extrairTexto(payload, "data.student")).toBeNull();
    expect(extrairTexto(payload, "data.student.ativo")).toBeNull();
    expect(extrairTexto(payload, null)).toBeNull();
  });

  it("texto: número vira texto, vazio vira nulo", () => {
    expect(texto(4455)).toBe("4455");
    expect(texto("  ")).toBeNull();
    expect(texto({})).toBeNull();
  });

  it("e-mail: minúsculo, sem espaço, e inválido vira nulo (CHECK contacts_email_format)", () => {
    expect(emailNormalizado(" JOAO@Email.com ")).toBe("joao@email.com");
    expect(emailNormalizado("joao@")).toBeNull();
    expect(emailNormalizado("jo ao@x.com")).toBeNull();
    expect(emailNormalizado(42)).toBeNull();
  });

  it("dinheiro: reais → centavos e os formatos da personalizada", () => {
    expect(reaisEmCentavos(297.9)).toBe(29790);
    expect(reaisEmCentavos("197.00")).toBe(19700);
    expect(reaisEmCentavos(null)).toBeNull();
    expect(textoEmCentavos("197,90")).toBe(19790);
    expect(textoEmCentavos("1.234,56")).toBe(123456);
    expect(textoEmCentavos("R$ 197,90")).toBe(19790);
    expect(textoEmCentavos("197.90")).toBe(19790);
    expect(textoEmCentavos("19700", "centavos")).toBe(19700);
    expect(textoEmCentavos("grátis")).toBeNull();
    expect(valorEmReais(123456)).toBe("1.234,56");
    expect(valorEmReais(5)).toBe("0,05");
    expect(valorEmReais(null)).toBeNull();
  });

  it("slug e verdade do PHP", () => {
    expect(slug("lesson completed")).toBe("lesson_completed");
    expect(slug("Ação Única")).toBe("acao_unica");
    expect(verdadeiroDoPhp(true)).toBe(true);
    expect(verdadeiroDoPhp("false")).toBe(true);
    expect(verdadeiroDoPhp("0")).toBe(false);
    expect(verdadeiroDoPhp(0)).toBe(false);
    expect(verdadeiroDoPhp(undefined)).toBe(false);
  });
});
