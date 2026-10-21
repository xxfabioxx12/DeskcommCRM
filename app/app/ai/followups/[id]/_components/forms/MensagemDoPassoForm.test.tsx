/**
 * O PASSO "MENSAGEM" NA TELA — as duas caixas, a de template é a MESMA tela de
 * lacunas da campanha; o config sai no formato do schema.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { avaliarModeloParaCampanha } from "@/lib/campanhas/template-da-campanha";
import { umPorNomeEIdioma } from "@/hooks/followup/useModeloDoFluxo";

const estado = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/followup/useModeloDoFluxo", async (original) => ({
  ...(await original<typeof import("@/hooks/followup/useModeloDoFluxo")>()),
  useModeloDoFluxo: () => estado.valor,
}));

import { MensagemDoPassoForm } from "./MensagemDoPassoForm";

const MODELO = {
  name: "acesso", language: "pt_BR", status: "APPROVED", category: "UTILITY", rejectedReason: null, qualityScore: null,
  parameterFormat: "POSITIONAL", contractHash: "h1", syncedAt: "2026-10-21T00:00:00Z",
  slots: [{ key: "1", valueKey: "1", expects: "text", onde: "corpo" }],
  previews: [], savedValues: {}, components: [{ type: "BODY", text: "Oi {{1}}" }],
};
const opcao = { modelo: MODELO, avaliacao: avaliarModeloParaCampanha(MODELO.slots, {}) };

beforeEach(() => {
  estado.valor = { carregando: false, opcoes: [opcao], atual: null, desatualizado: false, preencher: null };
});

describe("MensagemDoPassoForm", () => {
  it("mostra as duas caixas e a regra de 'ao menos uma'", () => {
    render(<MensagemDoPassoForm config={{ mode: "mensagem" }} onChange={vi.fn()} />);
    expect(screen.getByText("Número oficial")).toBeInTheDocument();
    expect(screen.getByLabelText("Número comum (QR Code)")).toBeInTheDocument();
    expect(screen.getByText(/Preencha ao menos uma das duas/)).toBeInTheDocument();
  });

  it("texto do número comum vai para texto.body; vazio some do config", () => {
    const onChange = vi.fn();
    render(<MensagemDoPassoForm config={{ mode: "mensagem" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Número comum (QR Code)"), { target: { value: "Oi {{primeiro_nome}}" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "mensagem", texto: { body: "Oi {{primeiro_nome}}" } });
    fireEvent.change(screen.getByLabelText("Número comum (QR Code)"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "mensagem" });
  });

  it("escolher o template grava nome, idioma e carimbo do contrato", () => {
    const onChange = vi.fn();
    render(<MensagemDoPassoForm config={{ mode: "mensagem" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Template aprovado pela Meta"), { target: { value: "acesso|pt_BR" } });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: "mensagem",
      modelo: { name: "acesso", language: "pt_BR", contract_hash: "h1", slot_map: {} },
    });
  });

  it("preencher a lacuna grava no slot_map", () => {
    estado.valor = { carregando: false, opcoes: [opcao], atual: opcao, desatualizado: false, preencher: MODELO.slots };
    const onChange = vi.fn();
    render(
      <MensagemDoPassoForm
        config={{ mode: "mensagem", modelo: { name: "acesso", language: "pt_BR", contract_hash: "h1", slot_map: {} } }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/\{\{1\}\} · corpo/), { target: { value: "{{primeiro_nome}}" } });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: "mensagem",
      modelo: { name: "acesso", language: "pt_BR", contract_hash: "h1", slot_map: { "1": "{{primeiro_nome}}" } },
    });
  });

  it("a lista da conta fica com UM por nome+idioma, só os aprovados", () => {
    const outro = { ...MODELO, contractHash: "h2" };
    const pausado = { ...MODELO, name: "velho", status: "PAUSED" };
    expect(umPorNomeEIdioma([MODELO, outro, pausado] as never).map((m) => m.contractHash)).toEqual(["h1"]);
  });

  it("abre com o que já estava salvo e mexer numa caixa preserva a outra", () => {
    estado.valor = { carregando: false, opcoes: [opcao], atual: opcao, desatualizado: false, preencher: MODELO.slots };
    const onChange = vi.fn();
    const salvo = {
      mode: "mensagem" as const,
      modelo: { name: "acesso", language: "pt_BR", contract_hash: "h1", slot_map: { "1": "{{nome}}" } },
      texto: { body: "Oi" },
    };
    render(<MensagemDoPassoForm config={salvo} onChange={onChange} />);
    expect(screen.getByLabelText("Número comum (QR Code)")).toHaveValue("Oi");
    expect(screen.getByLabelText(/\{\{1\}\} · corpo/)).toHaveValue("{{nome}}");
    fireEvent.change(screen.getByLabelText("Número comum (QR Code)"), { target: { value: "Oi!" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...salvo, texto: { body: "Oi!" } });
  });
});
