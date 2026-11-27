import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const h = vi.hoisted(() => ({
  conexoes: [{ id: "c1", name: "Hotmart NODZ", kind: "hotmart", config: {} }],
  produtos: [{ produto_id: "4455", produto: "Curso Hotmart" }],
}));
vi.mock("@/hooks/vendas/useConexoesDeVenda", () => ({ useConexoesDeVenda: () => ({ data: { data: h.conexoes } }) }));
vi.mock("@/hooks/vendas/useEventosDeVenda", () => ({ useProdutosDaVenda: () => ({ data: { data: h.produtos } }) }));

import { ActionConfigForm } from "@/app/app/webhooks/_components/ActionConfigForm";
import { ConfigDaVendaNaRegra } from "@/app/app/webhooks/_components/ConfigDaVendaNaRegra";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import { CONFIG_DA_VENDA_VAZIA, type ConfigDaVendaNaTela } from "@/lib/vendas/filtro-da-regra";

function montar(inicial: ConfigDaVendaNaTela = CONFIG_DA_VENDA_VAZIA) {
  const onChange = vi.fn();
  function Tela() {
    const [valor, setValor] = React.useState(inicial);
    return (
      <ConfigDaVendaNaRegra
        valor={valor}
        onChange={(novo) => {
          onChange(novo);
          setValor(novo);
        }}
      />
    );
  }
  const user = userEvent.setup({ delay: null });
  render(<Tela />);
  return { user, onChange };
}

const DICA =
  "Nesta automação de venda também valem {{venda.nome}}, {{venda.primeiro_nome}}, {{venda.email}}, {{venda.telefone}}, {{venda.produto}}, {{venda.pedido}}, {{venda.valor}}, {{venda.checkout_url}}, {{venda.extra.campo}} e {{venda.payload.caminho}}.";

describe("filtros do gatilho Venda recebida", () => {
  it("conexão, produto, evento e ignorar order bump vão para o filtro", async () => {
    const { user, onChange } = montar();
    await user.click(screen.getByRole("combobox", { name: "Conexão de venda" }));
    await user.click(await screen.findByRole("option", { name: "Hotmart NODZ" }));
    await user.click(screen.getByRole("combobox", { name: "Produto" }));
    await user.click(await screen.findByRole("option", { name: "Curso Hotmart (4455)" }));
    await user.click(screen.getByRole("combobox", { name: "Evento padrão" }));
    await user.click(await screen.findByRole("option", { name: "Compra aprovada" }));
    await user.click(screen.getByRole("switch", { name: "Ignorar order bump" }));
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({
      conexao_id: "c1",
      plataforma: "",
      produto_id: "4455",
      evento: "compra.aprovada",
      ignorar_order_bump: true,
    });
  });

  it("valor gravado fora da lista aparece; 'qualquer' volta a vazio", async () => {
    const { user, onChange } = montar({ ...CONFIG_DA_VENDA_VAZIA, produto_id: "999", evento: "custom.aula_vista" });
    expect(screen.getByRole("combobox", { name: "Produto" }).textContent).toContain("999");
    expect(screen.getByRole("combobox", { name: "Evento padrão" }).textContent).toContain("custom.aula_vista");
    await user.click(screen.getByRole("combobox", { name: "Produto" }));
    await user.click(await screen.findByRole("option", { name: "Qualquer produto" }));
    expect(onChange.mock.calls.at(-1)?.[0].produto_id).toBe("");
  });
});

describe("Gravar campo no editor de regras", () => {
  it("mostra as variáveis da venda só no gatilho de venda", () => {
    const acao = { type: "set_field" as const, config: { destino: "contato" as const, campo: "", valor: "" } };
    const { rerender } = render(<ActionConfigForm action={acao} onChange={() => undefined} gatilho="sale.received" />);
    expect(screen.getByText(DICA)).toBeInTheDocument();
    expect(DICIONARIO[DICA]?.es).toBeTruthy();
    rerender(<ActionConfigForm action={acao} onChange={() => undefined} gatilho="contact.tag_added" />);
    expect(screen.queryByText(DICA)).toBeNull();
  });
});
