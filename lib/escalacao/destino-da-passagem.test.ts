import { describe, expect, it } from "vitest";

import { decidirDestinoDaPassagem } from "./destino-da-passagem";

const HENRIQUE = "11111111-1111-4111-8111-111111111111";
const ROBSON = "33333333-3333-4333-8333-333333333333";
const OUTRO = "44444444-4444-4444-8444-444444444444";

describe("decidirDestinoDaPassagem", () => {
  it("suporte com um atendente responsável vai para ele", () => {
    expect(decidirDestinoDaPassagem({ nomeDoNumero: "Suporte · 2233", responsaveisAtendentes: [HENRIQUE] })).toBe(
      HENRIQUE,
    );
  });

  it("comercial fica como está, mesmo com um responsável", () => {
    expect(decidirDestinoDaPassagem({ nomeDoNumero: "Comercial · 1509", responsaveisAtendentes: [ROBSON] })).toBeNull();
  });

  it("suporte com dois atendentes não escolhe", () => {
    expect(
      decidirDestinoDaPassagem({ nomeDoNumero: "Suporte · 2233", responsaveisAtendentes: [HENRIQUE, OUTRO] }),
    ).toBeNull();
  });

  it("número sem setor no nome não escolhe", () => {
    expect(decidirDestinoDaPassagem({ nomeDoNumero: "Robson Comercial 2023", responsaveisAtendentes: [ROBSON] })).toBeNull();
    expect(decidirDestinoDaPassagem({ nomeDoNumero: null, responsaveisAtendentes: [HENRIQUE] })).toBeNull();
  });
});
