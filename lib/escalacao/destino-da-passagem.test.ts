import { describe, expect, it } from "vitest";

import { decidirDestinoDaPassagem } from "./destino-da-passagem";

const HENRIQUE = "11111111-1111-4111-8111-111111111111";
const FABIO = "22222222-2222-4222-8222-222222222222";
const ROBSON = "33333333-3333-4333-8333-333333333333";

describe("decidirDestinoDaPassagem", () => {
  it("número com um responsável (suporte) vai para ele, mesmo com carteira de outro", () => {
    expect(
      decidirDestinoDaPassagem({ responsaveisDoNumero: [HENRIQUE], carteira: FABIO, carteiraQualificada: true }),
    ).toEqual({ userId: HENRIQUE, motivo: "responsavel_do_numero" });
  });

  it("número com dois responsáveis usa o dono da carteira", () => {
    expect(
      decidirDestinoDaPassagem({ responsaveisDoNumero: [FABIO, ROBSON], carteira: ROBSON, carteiraQualificada: true }),
    ).toEqual({ userId: ROBSON, motivo: "dono_da_carteira" });
  });

  it("dois responsáveis e sem carteira fica em Aguardando", () => {
    expect(
      decidirDestinoDaPassagem({ responsaveisDoNumero: [FABIO, ROBSON], carteira: null, carteiraQualificada: false }),
    ).toEqual({ userId: null, motivo: "sem_destino" });
  });

  it("carteira de quem saiu da equipe não conta", () => {
    expect(
      decidirDestinoDaPassagem({ responsaveisDoNumero: [], carteira: FABIO, carteiraQualificada: false }),
    ).toEqual({ userId: null, motivo: "sem_destino" });
  });
});
