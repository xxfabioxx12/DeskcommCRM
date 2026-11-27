import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  estado: null as Record<string, unknown> | null,
  conectar: vi.fn(async (_corpo: Record<string, unknown>) => ({ data: { displayName: "NODZ", phoneNumber: null } })),
}));

vi.mock("@/hooks/channels/useOfficialChannel", () => ({
  useOfficialChannel: () => ({ data: { data: h.estado }, isPending: false }),
  useConnectOfficialChannel: () => ({ mutateAsync: h.conectar, isPending: false }),
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
  h.conectar.mockClear();
});

function preencherEEnviar(conta?: string) {
  fireEvent.change(screen.getByLabelText("ID do número de telefone"), { target: { value: "845199182001279" } });
  fireEvent.change(screen.getByLabelText("ID da conta do WhatsApp Business"), { target: { value: "1604858698014735" } });
  fireEvent.change(screen.getByLabelText("Token de acesso"), { target: { value: "EAAGx" } });
  if (conta !== undefined) {
    fireEvent.change(screen.getByLabelText("ID da conta de mensagens (opcional)"), { target: { value: conta } });
  }
  fireEvent.submit(screen.getByTestId("btn-conectar").closest("form")!);
}

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

describe("tela da conexão oficial — envio da conta de mensagens", () => {
  it("⭐ GET falho e campo intocado: não manda a conta (não apaga a salva)", async () => {
    h.estado = null;
    render(<CanalOficialClient />);
    preencherEEnviar();
    await waitFor(() => expect(h.conectar).toHaveBeenCalledTimes(1));
    expect(h.conectar.mock.calls[0]![0]).not.toHaveProperty("messaging_account_id");
  });

  it("campo mexido: manda o valor digitado (vazio apaga de propósito)", async () => {
    render(<CanalOficialClient />);
    preencherEEnviar("");
    await waitFor(() => expect(h.conectar).toHaveBeenCalledTimes(1));
    expect(h.conectar.mock.calls[0]![0]).toMatchObject({ messaging_account_id: "" });
  });
});

describe("tela da conexão oficial — sem autorização", () => {
  it("⭐ troca o WORKING pela frase e mostra o último erro", () => {
    h.estado = {
      ...CONECTADO,
      semAutorizacao: { detalhe: "meta_10: (subcode 2593181; fbtrace AbC) Application does not have permission", em: "2026-10-22T15:00:00Z" },
    };
    render(<CanalOficialClient />);
    const cartao = screen.getByTestId("canal-conectado").textContent ?? "";
    expect(cartao).toContain("Recebe, mas não tem autorização para mandar");
    expect(cartao).not.toContain("WORKING");
    expect(screen.getByTestId("sem-autorizacao").textContent).toContain("subcode 2593181");
  });

  it("sem recusa: o status de sempre", () => {
    render(<CanalOficialClient />);
    expect(screen.getByTestId("canal-conectado").textContent).toContain("WORKING");
    expect(screen.queryByTestId("sem-autorizacao")).toBeNull();
  });
});
