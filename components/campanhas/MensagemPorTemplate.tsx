"use client";
/**
 * A mensagem da campanha num número que EXIGE template aprovado (fatia 4 da #1330).
 *
 * Quem decide se esta seção aparece é a CAPACIDADE do canal (a tela chama
 * `canalExigeTemplate`), nunca o nome dele. Aqui: só os templates aprovados do
 * número, os que a campanha não consegue preencher desabilitados COM o motivo
 * (a mesma função com que o servidor recusa), um campo por variável que aceita as
 * variáveis da campanha ou texto fixo, a prévia e o aviso de custo — sem valor em
 * reais, porque o produto não tem tabela e a plataforma muda o preço.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModeloDaCampanha, type OpcaoDeModelo } from "@/hooks/campanhas/useModeloDaCampanha";
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

export function MensagemPorTemplate({
  channelSessionId,
  valor,
  onChange,
  exemplo,
}: {
  channelSessionId: string;
  valor: MensagemDoFormulario;
  onChange: (v: MensagemDoFormulario) => void;
  /** Valores resolvidos para uma pessoa da audiência (a prévia da lista), quando já pedida. */
  exemplo: Record<string, string> | null;
}) {
  const t = useT();
  const { carregando, opcoes, atual, desatualizado, preencher } = useModeloDaCampanha(channelSessionId, valor.modelo);
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
    const slotMap = mesmo
      ? Object.fromEntries(Object.entries(valor.slotMap).filter(([k]) => chavesDeHoje.has(k)))
      : {};
    onChange({
      ...valor,
      modelo: { name: opcao.modelo.name, language: opcao.modelo.language, contractHash: opcao.modelo.contractHash },
      slotMap,
    });
  }

  function preencherSlot(chave: string, expressao: string) {
    onChange({ ...valor, slotMap: { ...valor.slotMap, [chave]: expressao } });
  }

  // O exemplo vale só para o template e o mapa com que a prévia foi PEDIDA: as
  // telas descartam a prévia (`previa.reset()`) a cada troca de número, de
  // template ou de variável. Aqui, a segunda trava: template sem slots em dia
  // (`preencher` nulo — desatualizado ou inutilizável) nunca usa exemplo.
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
      <p className="text-sm text-muted-foreground">
        {t(
          "Este número é oficial: para quem não falou com você nas últimas 24 horas, a Meta só entrega template aprovado.",
        )}
      </p>

      <div className="space-y-2">
        <Label htmlFor="modelo-da-campanha">{t("Template aprovado pela Meta")}</Label>
        <select
          id="modelo-da-campanha"
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
        {!carregando && opcoes.length === 0 && (
          <p className="text-sm text-warning-fg">
            {t("Nenhum template aprovado neste número. Sincronize os templates em Configurações › Templates.")}
          </p>
        )}
      </div>

      {valor.modelo && !atual && !carregando && (
        <p className="text-sm text-warning-fg">
          {t("O template salvo não está mais aprovado neste número. Escolha outro.")}{" "}
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
              <Label htmlFor={`slot-${slot.valueKey}`}>
                {`{{${slot.key}}}`} · {slot.onde}
              </Label>
              <Input
                id={`slot-${slot.valueKey}`}
                value={valor.slotMap[slot.valueKey] ?? ""}
                onChange={(e) => preencherSlot(slot.valueKey, e.target.value)}
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
          <p className="text-xs text-muted-foreground">
            {t(
              "Você pode usar {{primeiro_nome}}, {{nome}}, {{saudacao}}, {{contato.campo}} e {{lead.campo}}. Quem ficar sem o dado fica de fora, com o motivo na lista.",
            )}
          </p>
        </div>
      )}

      {previa && (
        <div className="space-y-1 rounded-md border border-border bg-surface-elevated p-3 text-sm">
          <p className="font-medium">{exemploValido ? t("Como chega para uma pessoa da lista") : t("Prévia do template")}</p>
          {previa.cabecalho && <p className="font-semibold">{previa.cabecalho}</p>}
          <p className="whitespace-pre-wrap">{previa.corpo}</p>
          {previa.rodape && <p className="text-xs text-muted-foreground">{previa.rodape}</p>}
          {!exemploValido && (
            <p className="text-xs text-muted-foreground">
              {t("Para ver como chega para uma pessoa da lista, clique em “Ver quantas pessoas”.")}
            </p>
          )}
        </div>
      )}

      <p className="text-sm text-warning-fg">
        {t("A Meta cobra por mensagem entregue de template. O valor depende da categoria do template.")}
      </p>
    </div>
  );
}
