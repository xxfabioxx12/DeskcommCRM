import { describe, expect, it } from "vitest";

import { deveConcluir, lerMinutosDoPrazo, type FatosDaConversaParada } from "./concluir-ia-sem-resposta";

const AGORA = Date.parse("2026-11-13T18:00:00Z");
const base: FatosDaConversaParada = {
  nomeDoNumero: "Suporte · 2233",
  status: "open",
  vendedor: null,
  casoAberto: false,
  iaCalada: false,
  ultima: { direcao: "outbound", via: "ai", em: "2026-11-13T16:30:00Z" },
  ultimaDoCliente: "2026-11-13T16:29:00Z",
  minutos: 60,
};

describe("deveConcluir", () => {
  it("IA falou por último há mais de 1 hora no suporte: conclui", () => {
    expect(deveConcluir(base, AGORA)).toBe(true);
    expect(deveConcluir({ ...base, status: "ai_handling" }, AGORA)).toBe(true);
  });

  it("ainda dentro da hora: espera", () => {
    expect(deveConcluir({ ...base, ultima: { ...base.ultima!, em: "2026-11-13T17:30:00Z" } }, AGORA)).toBe(false);
  });

  it("cliente falou por último ou a última foi de uma pessoa: não conclui", () => {
    expect(deveConcluir({ ...base, ultimaDoCliente: "2026-11-13T16:31:00Z" }, AGORA)).toBe(false);
    expect(deveConcluir({ ...base, ultima: { ...base.ultima!, via: "crm" } }, AGORA)).toBe(false);
    expect(deveConcluir({ ...base, ultima: { ...base.ultima!, direcao: "inbound" } }, AGORA)).toBe(false);
    expect(deveConcluir({ ...base, ultima: null }, AGORA)).toBe(false);
  });

  it("com vendedor, esperando pessoa ou IA calada pela passagem: não conclui", () => {
    expect(deveConcluir({ ...base, vendedor: "u1" }, AGORA)).toBe(false);
    expect(deveConcluir({ ...base, status: "pending" }, AGORA)).toBe(false);
    expect(deveConcluir({ ...base, status: "claimed" }, AGORA)).toBe(false);
    expect(deveConcluir({ ...base, casoAberto: true }, AGORA)).toBe(false);
    expect(deveConcluir({ ...base, iaCalada: true }, AGORA)).toBe(false);
  });

  it("comercial fica como está", () => {
    expect(deveConcluir({ ...base, nomeDoNumero: "Comercial · 1509" }, AGORA)).toBe(false);
  });
});

describe("lerMinutosDoPrazo", () => {
  it("só inteiro de 5 para cima liga", () => {
    expect(lerMinutosDoPrazo({ concluir_ia_sem_resposta_minutos: 60 })).toBe(60);
    expect(lerMinutosDoPrazo({})).toBeNull();
    expect(lerMinutosDoPrazo({ concluir_ia_sem_resposta_minutos: 1 })).toBeNull();
    expect(lerMinutosDoPrazo({ concluir_ia_sem_resposta_minutos: "60" })).toBeNull();
    expect(lerMinutosDoPrazo(null)).toBeNull();
  });
});
