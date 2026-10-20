/**
 * A SEÇÃO "MENSAGEM" NUM NÚMERO QUE EXIGE TEMPLATE.
 *
 * Só templates aprovados do número; o que a campanha não preenche aparece
 * desabilitado COM o motivo; um campo por variável com atalhos; e o aviso de
 * custo sem número de preço.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { avaliarModeloParaCampanha } from "@/lib/campanhas/template-da-campanha";

const estado = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/campanhas/useModeloDaCampanha", () => ({ useModeloDaCampanha: () => estado.valor }));

import { MensagemPorTemplate } from "./MensagemPorTemplate";

const slot = (valueKey: string, expects = "text") => ({ key: valueKey.split(":").pop() ?? valueKey, valueKey, expects, onde: "corpo" });
const modelo = (name: string, slots: ReturnType<typeof slot>[], savedValues: Record<string, string> = {}) => ({
  name,
  language: "pt_BR",
  status: "APPROVED",
  category: "MARKETING",
  rejectedReason: null,
  qualityScore: null,
  parameterFormat: "POSITIONAL",
  contractHash: `h-${name}`,
  syncedAt: "2026-10-20T00:00:00.000Z",
  slots,
  previews: [],
  savedValues,
  components: [{ type: "BODY", text: "Oi {{1}}, tudo bem?" }],
});
const opcao = (m: ReturnType<typeof modelo>) => ({ modelo: m, avaliacao: avaliarModeloParaCampanha(m.slots, m.savedValues) });

const USAVEL = modelo("boas_vindas", [slot("1")]);
const SEM_LINK = modelo("com_imagem", [slot("header:1", "image"), slot("1")]);

beforeEach(() => {
  estado.valor = { carregando: false, opcoes: [opcao(USAVEL), opcao(SEM_LINK)], atual: null, desatualizado: false, preencher: null };
});

describe("MensagemPorTemplate", () => {
  it("explica o número oficial e avisa o custo sem número de preço", () => {
    render(<MensagemPorTemplate channelSessionId="s-1" valor={{ texto: "", modelo: null, slotMap: {} }} onChange={vi.fn()} exemplo={null} />);
    expect(screen.getByText(/Este número é oficial/)).toBeInTheDocument();
    expect(screen.getByText(/A Meta cobra por mensagem entregue de template/)).toBeInTheDocument();
  });

  it("template que a campanha não preenche aparece desabilitado com o motivo", () => {
    render(<MensagemPorTemplate channelSessionId="s-1" valor={{ texto: "", modelo: null, slotMap: {} }} onChange={vi.fn()} exemplo={null} />);
    const desabilitado = screen.getByRole("option", { name: /com_imagem/ }) as HTMLOptionElement;
    expect(desabilitado.disabled).toBe(true);
    expect(desabilitado.textContent).toContain("Cabeçalho com imagem, vídeo ou documento sem link salvo");
    const usavel = screen.getByRole("option", { name: /boas_vindas/ }) as HTMLOptionElement;
    expect(usavel.disabled).toBe(false);
    // Nome, idioma, categoria e o TEXTO do template — não só o nome técnico.
    expect(usavel.textContent).toBe("boas_vindas · pt_BR · Marketing · Oi {{1}}, tudo bem?");
  });

  it("escolher um template grava nome, idioma e o carimbo do contrato", () => {
    const onChange = vi.fn();
    render(<MensagemPorTemplate channelSessionId="s-1" valor={{ texto: "", modelo: null, slotMap: {} }} onChange={onChange} exemplo={null} />);
    fireEvent.change(screen.getByLabelText("Template aprovado pela Meta"), { target: { value: "boas_vindas|pt_BR" } });
    expect(onChange).toHaveBeenCalledWith({
      texto: "",
      modelo: { name: "boas_vindas", language: "pt_BR", contractHash: "h-boas_vindas" },
      slotMap: {},
    });
  });

  it("o atalho Primeiro nome preenche a variável com {{primeiro_nome}}", () => {
    estado.valor = { ...estado.valor, atual: opcao(USAVEL), preencher: [slot("1")] };
    const onChange = vi.fn();
    const escolhido = { name: "boas_vindas", language: "pt_BR", contractHash: "h-boas_vindas" };
    render(<MensagemPorTemplate channelSessionId="s-1" valor={{ texto: "", modelo: escolhido, slotMap: {} }} onChange={onChange} exemplo={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Primeiro nome" }));
    expect(onChange).toHaveBeenCalledWith({ texto: "", modelo: escolhido, slotMap: { "1": "{{primeiro_nome}}" } });
  });

  it("a prévia usa o exemplo da audiência quando há", () => {
    estado.valor = { ...estado.valor, atual: opcao(USAVEL), preencher: [slot("1")] };
    const escolhido = { name: "boas_vindas", language: "pt_BR", contractHash: "h-boas_vindas" };
    render(
      <MensagemPorTemplate channelSessionId="s-1" valor={{ texto: "", modelo: escolhido, slotMap: { "1": "{{primeiro_nome}}" } }} onChange={vi.fn()} exemplo={{ "1": "Ana" }} />,
    );
    expect(screen.getByText("Oi Ana, tudo bem?")).toBeInTheDocument();
  });

  it("template que mudou na Meta pede para escolher de novo", () => {
    estado.valor = { ...estado.valor, atual: opcao(USAVEL), desatualizado: true, preencher: null };
    const onChange = vi.fn();
    const velho = { name: "boas_vindas", language: "pt_BR", contractHash: "h-velho" };
    render(<MensagemPorTemplate channelSessionId="s-1" valor={{ texto: "", modelo: velho, slotMap: { "1": "{{nome}}" } }} onChange={onChange} exemplo={null} />);
    expect(screen.getByText("O template mudou na Meta: escolha de novo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usar a versão atual" }));
    expect(onChange).toHaveBeenCalledWith({
      texto: "",
      modelo: { name: "boas_vindas", language: "pt_BR", contractHash: "h-boas_vindas" },
      slotMap: { "1": "{{nome}}" },
    });
  });
});
