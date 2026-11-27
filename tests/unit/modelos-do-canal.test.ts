/**
 * QUEM GERENCIA TEMPLATES PELA TELA — pela capacidade, nunca pelo nome.
 */
import { describe, expect, it } from "vitest";

import {
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_SOCIAL,
  CHANNEL_PROVIDER_WAHA,
  CHANNEL_PROVIDER_ZERNIO,
} from "@/lib/channels/capabilities";
import { metaCloudTemplateOps } from "@/lib/channels/meta/template-ops";
import { opsDeModelosDaContaOficial, opsDeModelosDoCanal } from "@/lib/channels/modelos-do-canal";

describe("opsDeModelosDoCanal", () => {
  it("canal que gerencia definições devolve as operações do adapter", () => {
    expect(opsDeModelosDoCanal(CHANNEL_PROVIDER_META)).toBe(metaCloudTemplateOps);
    expect(opsDeModelosDoCanal(CHANNEL_PROVIDER_ZERNIO)).not.toBeNull();
    expect(opsDeModelosDaContaOficial()).toBe(metaCloudTemplateOps);
  });
  it("QR Code, rede social, voz e desconhecido: nenhuma", () => {
    expect(opsDeModelosDoCanal(CHANNEL_PROVIDER_WAHA)).toBeNull();
    expect(opsDeModelosDoCanal(CHANNEL_PROVIDER_SOCIAL)).toBeNull();
    expect(opsDeModelosDoCanal("wacalls")).toBeNull();
    expect(opsDeModelosDoCanal("telegram")).toBeNull();
    expect(opsDeModelosDoCanal(null)).toBeNull();
  });
});
