"use client";
/**
 * Seletor de template aprovado + uma caixa por lacuna + prévia — a MESMA tela na
 * campanha (`MensagemPorTemplate`) e no passo "Mensagem" do fluxo. Quem chama
 * passa o estado (templates do número ou da conta) e as frases do seu contexto,
 * já traduzidas.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ModeloDaCampanha, OpcaoDeModelo } from "@/hooks/campanhas/useModeloDaCampanha";
import { useT } from "@/hooks/i18n/useT";
import { renderTemplatePreview } from "@/lib/channels/meta/render-template";
import {
  CATEGORIA_DO_MODELO,
  TEXTO_DO_MODELO_INUTILIZAVEL,
  ehCategoriaConhecida,
  resumoDoCorpo,
  type MensagemDoFormulario,
} from "@/lib/campanhas/template-da-campanha";

const chaveDe = (o: OpcaoDeModelo) => `${o.modelo.name}|${o.modelo.language}`;

export interface PropsDasLacunas {
  idDoSeletor: string;
  estado: ModeloDaCampanha;
  valor: MensagemDoFormulario;
  onChange: (v: MensagemDoFormulario) => void;
  /** Valores resolvidos para uma pessoa (prévia da campanha), quando já pedidos. */
  exemplo: Record<string, string> | null;
  avisoSemModelos: string;
  avisoModeloSumiu: string;
  dicaDasVariaveis: string;
  tituloDaPreviaComExemplo?: string;
  dicaDaPrevia?: string;
}

export function LacunasDoTemplate({
  idDoSeletor,
  estado,
  valor,
  onChange,
  exemplo,
  avisoSemModelos,
  avisoModeloSumiu,
  dicaDasVariaveis,
  tituloDaPreviaComExemplo,
  dicaDaPrevia,
}: PropsDasLacunas) {
  const t = useT();
  const { carregando, opcoes, atual, desatualizado, preencher } = estado;
  const chaveAtual = valor.modelo ? `${valor.modelo.name}|${valor.modelo.language}` : "";

  function escolher(chave: string) {
    const opcao = opcoes.find((o) => chaveDe(o) === chave);
    if (!opcao || !opcao.avaliacao.usavel) {
      onChange({ ...valor, modelo: null, slotMap: {} });
      return;
    }
    // O MESMO template de novo (versão nova do contrato): as expressões cujos
    // slots continuam existindo ficam — o operador só preenche o que é novo.
    const mesmo = valor.modelo?.name === opcao.modelo.name && valor.modelo?.language === opcao.modelo.language;
    const chavesDeHoje = new Set(opcao.avaliacao.preencher.map((s) => s.valueKey));
    const slotMap = mesmo ? Object.fromEntries(Object.entries(valor.slotMap).filter(([k]) => chavesDeHoje.has(k))) : {};
    onChange({
      ...valor,
      modelo: { name: opcao.modelo.name, language: opcao.modelo.language, contractHash: opcao.modelo.contractHash },
      slotMap,
    });
  }

  function preencherSlot(chave: string, expressao: string) {
    onChange({ ...valor, slotMap: { ...valor.slotMap, [chave]: expressao } });
  }

  const exemploValido = exemplo && preencher ? exemplo : null;
  const previa = atual
    ? renderTemplatePreview(
        atual.modelo.components ?? [],
        { ...atual.modelo.savedValues, ...(exemploValido ?? valor.slotMap) },
        { name: atual.modelo.name, language: atual.modelo.language, parameterFormat: atual.modelo.parameterFormat },
      )
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={idDoSeletor}>{t("Template aprovado pela Meta")}</Label>
        <select
          id={idDoSeletor}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          value={chaveAtual}
          onChange={(e) => escolher(e.target.value)}
        >
          <option value="">{carregando ? t("Carregando…") : t("Escolha um template")}</option>
          {opcoes.map((o) => {
            const resumo = resumoDoCorpo(o.modelo.components);
            return (
              <option key={chaveDe(o)} value={chaveDe(o)} disabled={!o.avaliacao.usavel}>
                {o.modelo.name} · {o.modelo.language}
                {ehCategoriaConhecida(o.modelo.category) ? ` · ${t(CATEGORIA_DO_MODELO[o.modelo.category])}` : ""}
                {resumo ? ` · ${resumo}` : ""}
                {o.avaliacao.usavel ? "" : ` — ${t(TEXTO_DO_MODELO_INUTILIZAVEL[o.avaliacao.motivo])}`}
              </option>
            );
          })}
        </select>
        {!carregando && opcoes.length === 0 && <p className="text-sm text-warning-fg">{avisoSemModelos}</p>}
      </div>

      {valor.modelo && !atual && !carregando && (
        <p className="text-sm text-warning-fg">
          {avisoModeloSumiu}{" "}
          <span className="font-mono">
            {valor.modelo.name} · {valor.modelo.language}
          </span>
        </p>
      )}

      {desatualizado && atual && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-warning-fg">
          <span>{t("O template mudou na Meta: escolha de novo.")}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => escolher(chaveDe(atual))}>
            {t("Usar a versão atual")}
          </Button>
        </div>
      )}

      {preencher && preencher.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("Variáveis do template")}</p>
          {preencher.map((slot) => (
            <div key={slot.valueKey} className="space-y-1">
              <Label htmlFor={`${idDoSeletor}-slot-${slot.valueKey}`}>
                {`{{${slot.key}}}`} · {slot.onde}
              </Label>
              <Input
                id={`${idDoSeletor}-slot-${slot.valueKey}`}
                value={valor.slotMap[slot.valueKey] ?? ""}
                onChange={(e) => preencherSlot(slot.valueKey, e.target.value)}
                maxLength={1000}
                placeholder={t("Texto fixo ou {{primeiro_nome}}, {{contato.campo}}…")}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => preencherSlot(slot.valueKey, "{{primeiro_nome}}")}>
                  {t("Primeiro nome")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => preencherSlot(slot.valueKey, "{{nome}}")}>
                  {t("Nome completo")}
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{dicaDasVariaveis}</p>
          <p className="text-xs text-muted-foreground">
            {t('Para não depender do dado, ponha um texto de reserva: {{primeiro_nome|"aluno"}}.')}
          </p>
        </div>
      )}

      {previa && (
        <div className="space-y-1 rounded-md border border-border bg-surface-elevated p-3 text-sm">
          <p className="font-medium">{exemploValido && tituloDaPreviaComExemplo ? tituloDaPreviaComExemplo : t("Prévia do template")}</p>
          {previa.cabecalho && <p className="font-semibold">{previa.cabecalho}</p>}
          <p className="whitespace-pre-wrap">{previa.corpo}</p>
          {previa.rodape && <p className="text-xs text-muted-foreground">{previa.rodape}</p>}
          {!exemploValido && dicaDaPrevia && <p className="text-xs text-muted-foreground">{dicaDaPrevia}</p>}
        </div>
      )}
    </div>
  );
}
