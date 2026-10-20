/**
 * A LIGAÇÃO do ramo de template em `rodarUmaCampanha`.
 *
 * Rodar a rodada inteira exige ritmo, pool de pacing e canal; as PEÇAS estão em
 * `campanha-template-envio.test.ts`. Este guarda prova as decisões de ligação que
 * quebrariam em silêncio num refactor — cada uma é uma linha que, removida, deixa
 * tudo compilando e as peças verdes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FONTE = readFileSync(join(process.cwd(), "lib/campanhas/rodada.ts"), "utf8");

describe("rodada × template", () => {
  it("a definição é conferida ANTES da reserva do destinatário", () => {
    const montar = FONTE.indexOf("montarEnvioDoTemplate(");
    const reserva = FONTE.indexOf("await reservarDestinatario(admin, alvo.id, agora)");
    expect(montar, "montarEnvioDoTemplate( sumiu da rodada").toBeGreaterThan(-1);
    expect(reserva, "a chamada da reserva sumiu").toBeGreaterThan(-1);
    expect(montar).toBeLessThan(reserva);
  });
  it("a linha do espelho é a do número ESCOLHIDO no rodízio", () => {
    expect(FONTE).toMatch(/linhaDoEspelho<LinhaDoModelo>\([\s\S]{0,300}channelSessionId:\s*sessionEscolhida/);
  });
  it("o intervalo mínimo da plataforma entra na decisão de cada número", () => {
    expect(FONTE).toMatch(/podeAgora:\s*decisao\.allow\s*&&\s*intervaloDoCanalCumprido\(/);
  });
  it("template parado pausa a campanha nos dois pontos (antes e depois do envio)", () => {
    expect(FONTE.match(/pausarPorTemplate\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(FONTE).toMatch(/falhaDoEnvioParaACampanha\(/);
  });
  it("agendada que vira running na rodada passa pela mesma conferência na hora do envio", () => {
    // A promoção acontece ANTES da busca das campanhas em andamento: a recém-promovida
    // entra nesta mesma rodada e cai no ramo de template (template que mudou entre o
    // agendamento e a hora do envio pausa aqui, não queima a lista).
    const promove = FONTE.indexOf("await promoverAgendadas(admin, agora)");
    const busca = FONTE.indexOf('.eq("status", "running")');
    expect(promove).toBeGreaterThan(-1);
    expect(busca).toBeGreaterThan(promove);
    expect(FONTE).toMatch(/if \(campanha\.message_mode === "template"\)/);
  });
  it("o ramo de texto continua o mesmo", () => {
    expect(FONTE).toMatch(/type:\s*"text",\s*body:\s*corpo/);
  });
});
