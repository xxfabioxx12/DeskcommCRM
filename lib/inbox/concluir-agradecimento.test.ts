import { describe, expect, it } from "vitest";

import { perguntarAoJev, soAgradeceu } from "./concluir-agradecimento";

const resposta = (choice: string, confidence: number, probabilities: Record<string, number>) => ({
  answers: { selection: { choice, confidence, probabilities } },
});

describe("conclui só quando o Jev tem certeza de que o cliente só agradeceu", () => {
  it("aceita agradecimento com confiança e folga", () => {
    expect(soAgradeceu(resposta("so_agradeceu", 0.92, { so_agradeceu: 0.92, tem_pedido: 0.05, nenhuma: 0.03 }))).toBe(true);
  });

  it("recusa pedido, dúvida, confiança baixa e folga curta", () => {
    expect(soAgradeceu(resposta("tem_pedido", 0.9, { so_agradeceu: 0.05, tem_pedido: 0.9, nenhuma: 0.05 }))).toBe(false);
    expect(soAgradeceu(resposta("nenhuma", 0.9, { so_agradeceu: 0.05, tem_pedido: 0.05, nenhuma: 0.9 }))).toBe(false);
    expect(soAgradeceu(resposta("so_agradeceu", 0.7, { so_agradeceu: 0.7, tem_pedido: 0.2, nenhuma: 0.1 }))).toBe(false);
    expect(soAgradeceu(resposta("so_agradeceu", 0.8, { so_agradeceu: 0.55, tem_pedido: 0.4, nenhuma: 0.05 }))).toBe(false);
    expect(soAgradeceu({})).toBe(false);
  });

  it("manda a última resposta da equipe e a do cliente ao Jev, e falha fechado em erro HTTP", async () => {
    let corpo = "";
    const ok = (async (_url: string, init: RequestInit) => {
      corpo = String(init.body);
      return new Response(JSON.stringify(resposta("so_agradeceu", 0.95, { so_agradeceu: 0.95, tem_pedido: 0.04, nenhuma: 0.01 })));
    }) as unknown as typeof fetch;
    await expect(perguntarAoJev({ anterior: "Atendi, pode tentar.", ultima: "Gratidão" }, "k", ok)).resolves.toBe(true);
    expect(corpo).toContain("Atendi, pode tentar.");
    expect(corpo).toContain("Gratidão");
    const erro = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(perguntarAoJev({ anterior: null, ultima: "ok" }, "k", erro)).rejects.toThrow("jev_http_500");
  });
});
