/**
 * AS DUAS AÇÕES NOVAS NO EDITOR DE AUTOMAÇÕES — o formulário REAL
 * (`ActionConfigForm`), controlado como no editor.
 */
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
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

import { ActionConfigForm, defaultActionConfig, type ActionItem } from "@/app/app/webhooks/_components/ActionConfigForm";
import { ACTION_LABELS } from "@/app/app/webhooks/_components/labels";
import { VISUAL_DA_ACAO } from "@/app/app/webhooks/automacoes/[id]/_components/visual";
import { DICIONARIO } from "@/lib/i18n/dicionario";

function montar(inicial: ActionItem) {
  const onChange = vi.fn();
  function Editor() {
    const [acao, setAcao] = React.useState(inicial);
    return <ActionConfigForm action={acao} onChange={(n) => { onChange(n); setAcao(n); }} />;
  }
  const user = userEvent.setup({ delay: null });
  render(<Editor />);
  return { user, onChange };
}

describe("editor de automações — Tirar tag e Gravar campo", () => {
  it("rótulos, paleta e espanhol existem para as duas", () => {
    expect(ACTION_LABELS.remove_tag).toBe("Tirar tag");
    expect(ACTION_LABELS.set_field).toBe("Gravar campo");
    expect(VISUAL_DA_ACAO.remove_tag.paleta).toBe("Tirar tag");
    expect(VISUAL_DA_ACAO.set_field.paleta).toBe("Gravar campo");
    for (const frase of ["Tirar tag", "Gravar campo"]) expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
  });

  it("padrões: tirar do card; gravar no contato", () => {
    expect(defaultActionConfig("remove_tag")).toEqual({ type: "remove_tag", config: { tags: [], destino: "card" } });
    expect(defaultActionConfig("set_field")).toEqual({ type: "set_field", config: { destino: "contato", campo: "", valor: "" } });
  });

  it("Tirar tag: escrever as tags preserva o destino escolhido", async () => {
    const { user, onChange } = montar({ type: "remove_tag", config: { tags: [], destino: "contato" } });
    await user.type(screen.getByLabelText("Tags para tirar (separadas por vírgula)"), "vip, quente");
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ type: "remove_tag", config: { tags: ["vip", "quente"], destino: "contato" } });
  });

  it("Tirar tag: etiqueta de 41 no contato mostra o aviso", () => {
    montar({ type: "remove_tag", config: { tags: ["x".repeat(41)], destino: "contato" } });
    expect(screen.getByText("Etiqueta do contato com mais de 40 caracteres: encurte.")).toBeInTheDocument();
  });

  it("Gravar campo: campo e valor vão para o config", async () => {
    const { user, onChange } = montar(defaultActionConfig("set_field"));
    await user.type(screen.getByLabelText("Nome do campo"), "link");
    await user.type(screen.getByLabelText("Valor do campo"), "https://area");
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ type: "set_field", config: { destino: "contato", campo: "link", valor: "https://area" } });
  });
});
