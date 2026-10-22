import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ estado: null as Record<string, unknown> | null }));

vi.mock("@/hooks/channels/useOfficialChannel", () => ({
  useOfficialChannel: () => ({ data: { data: h.estado }, isPending: false }),
  useConnectOfficialChannel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegistrarWebhookOficial: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/connections/ChannelAiAccess", () => ({ ChannelAiAccess: () => null }));
vi.mock("@/components/connections/RespostaAutomatica", () => ({ RespostaAutomatica: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CanalOficialClient } from "@/components/connections/CanalOficialClient";

const CONECTADO = {
  connected: true,
  channel_session_id: "22222222-2222-4222-8222-222222222222",
  hasToken: true,
  phoneNumberId: "845199182001279",
  wabaId: "1604858698014735",
  contaDeMensagensId: "1288526903016074",
  endpoint: "https://graph.facebook.com/v23.0",
  displayName: "NODZ",
  phoneNumber: "+555181495911",
  status: "WORKING",
  webhook: null,
  webhookRegistro: null,
};

beforeEach(() => {
  h.estado = { ...CONECTADO };
});

describe("tela da conexão oficial — conta de mensagens", () => {
  it("mostra a conta no cartão da conexão", () => {
    render(<CanalOficialClient />);
    expect(screen.getByTestId("canal-conectado").textContent).toContain("1288526903016074");
  });

  it("⭐ o formulário vem com a conta de mensagens salva (trocar o token não a apaga)", () => {
    render(<CanalOficialClient />);
    expect((screen.getByLabelText("ID da conta de mensagens (opcional)") as HTMLInputElement).value).toBe(
      "1288526903016074",
    );
  });
});
