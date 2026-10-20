"use client";
/**
 * Criar, editar e apagar um template do canal OFICIAL direto (Etapa B da campanha
 * por template).
 *
 * Só texto (cabeçalho de texto, corpo com `{{n}}` e um exemplo para cada, rodapé,
 * até três respostas rápidas) e só Marketing/Utilidade. As regras são as MESMAS do
 * servidor (`problemasDoFormulario`), para o operador ver o problema antes de
 * enviar — o servidor confere de novo de qualquer jeito. A prévia é a da tela do
 * parceiro (`PreviaDaDefinicao`), ao lado, para não sair da tela junto do botão.
 */
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useGerirModeloOficial } from "@/hooks/channels/useModeloOficial";
import { useT } from "@/hooks/i18n/useT";
import { ApiError } from "@/lib/api/types";
import {
  LIMITE_CABECALHO,
  LIMITE_RESPOSTA_RAPIDA,
  NOME_DO_MODELO,
  formularioDoModelo,
  problemasDoFormulario,
  type ConteudoDoFormulario,
} from "@/lib/channels/criacao-de-modelo";
import {
  IDIOMAS_DA_DEFINICAO,
  LIMITE_BOTOES,
  LIMITE_CORPO,
  LIMITE_RODAPE,
  contarVariaveis,
} from "@/lib/channels/template-conteudo";
import { PencilSimple, Trash } from "@/lib/ui/icons";

import { PreviaDaDefinicao } from "./PreviaDaDefinicao";

export interface ModeloEmEdicao {
  name: string;
  language: string;
  components: unknown[];
}

const CAMPO = "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";

/**
 * A frase da falha para o aviso. A rota já devolve a recusa da Meta traduzida em
 * `message`; quando a frase é a NOSSA leitura do texto da Meta, o original vem em
 * `details.originalDaMeta` e aparece junto — "<frase> (Meta: <original>)" —, para
 * uma leitura errada nunca ficar silenciosa. Sem frase conhecida, `message` já é
 * o texto da Meta e vai sozinho.
 */
function mensagemDaFalha(e: unknown, reserva: string): string {
  if (!(e instanceof Error)) return reserva;
  const original =
    e instanceof ApiError && typeof e.details?.originalDaMeta === "string" && e.details.originalDaMeta.trim() !== ""
      ? e.details.originalDaMeta
      : null;
  return original ? `${e.message} (Meta: ${original})` : e.message;
}

export function FormularioDoModeloOficial({
  editando,
  onFechar,
}: {
  editando: ModeloEmEdicao | null;
  onFechar: () => void;
}) {
  const t = useT();
  const gerir = useGerirModeloOficial();
  const inicial = editando ? formularioDoModelo(editando.components) : null;
  const [nome, setNome] = useState(editando?.name ?? "");
  const [idioma, setIdioma] = useState(editando?.language ?? "pt_BR");
  const [categoria, setCategoria] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [cabecalho, setCabecalho] = useState(inicial?.cabecalho ?? "");
  const [corpo, setCorpo] = useState(inicial?.corpo ?? "");
  const [exemplos, setExemplos] = useState<string[]>(inicial?.exemplos ?? []);
  const [rodape, setRodape] = useState(inicial?.rodape ?? "");
  const [respostas, setRespostas] = useState<string[]>(inicial?.respostasRapidas ?? []);

  // Quantas amostras a revisão vai exigir — o campo aparece no instante em que
  // o operador escreve `{{1}}`, e não numa recusa que chega horas depois.
  const nVariaveis = contarVariaveis(corpo);
  const conteudo: ConteudoDoFormulario = {
    cabecalho: cabecalho.trim(),
    corpo: corpo.trim(),
    exemplos: Array.from({ length: nVariaveis }, (_, i) => (exemplos[i] ?? "").trim()),
    rodape: rodape.trim(),
    respostasRapidas: respostas.map((r) => r.trim()).filter(Boolean),
  };
  const nomeValido = !!editando || NOME_DO_MODELO.test(nome.trim());
  const problemas = conteudo.corpo ? problemasDoFormulario(conteudo) : [];
  const podeEnviar = nomeValido && conteudo.corpo !== "" && problemas.length === 0 && !gerir.isPending;

  async function enviar() {
    try {
      await gerir.mutateAsync(
        editando
          ? { acao: "editar", name: editando.name, language: editando.language, ...conteudo }
          : { acao: "criar", name: nome.trim(), language: idioma, category: categoria, ...conteudo },
      );
      toast.success(
        editando
          ? t("Modelo atualizado e enviado para revisão.")
          : t("Template enviado para a Meta. Ele aparece como Em análise até a Meta decidir."),
      );
      onFechar();
    } catch (e) {
      // A rota já devolve a recusa da Meta em frase do idioma de quem usa.
      toast.error(mensagemDaFalha(e, t("Não consegui falar com a plataforma.")));
    }
  }

  return (
    <div
      className="grid gap-4 rounded-md border border-border p-3 lg:grid-cols-[1fr_20rem]"
      data-formulario-do-modelo-oficial={editando ? "editar" : "criar"}
    >
      <div className="flex flex-col gap-2">
        {editando && (
          <p className="text-sm font-medium">
            {t("Editando")} <span className="font-mono">{editando.name}</span>{" "}
            <span className="text-xs font-normal text-muted-foreground">
              — {t("nome, idioma e categoria não mudam depois de criado.")}
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="nome_do_modelo"
            aria-label={t("Nome do modelo")}
            disabled={!!editando}
            className={`${CAMPO} flex-1`}
          />
          <select
            value={idioma}
            onChange={(e) => setIdioma(e.target.value)}
            aria-label={t("Idioma")}
            disabled={!!editando}
            className={`${CAMPO} w-56`}
          >
            {IDIOMAS_DA_DEFINICAO.map((i) => (
              <option key={i.codigo} value={i.codigo}>
                {t(i.rotulo)} ({i.codigo})
              </option>
            ))}
          </select>
        </div>
        {!nomeValido && nome.trim() !== "" && (
          <p className="text-xs text-destructive">{t("Use só letras minúsculas, números e _ no nome.")}</p>
        )}
        {!editando && (
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value === "UTILITY" ? "UTILITY" : "MARKETING")}
            aria-label={t("Categoria")}
            className={CAMPO}
          >
            <option value="MARKETING">{t("Marketing — promoção, novidade, reengajamento")}</option>
            <option value="UTILITY">{t("Utilidade — aviso de pedido, agendamento, cobrança")}</option>
          </select>
        )}
        <input
          value={cabecalho}
          onChange={(e) => setCabecalho(e.target.value.slice(0, LIMITE_CABECALHO))}
          placeholder={t("Cabeçalho de texto (opcional)")}
          aria-label={t("Cabeçalho de texto")}
          className={CAMPO}
        />
        <div className="flex flex-col gap-1">
          <textarea
            value={corpo}
            onChange={(e) => setCorpo(e.target.value.slice(0, LIMITE_CORPO))}
            placeholder={t("Texto da mensagem. Use {{1}}, {{2}} para os valores que mudam.")}
            aria-label={t("Conteúdo")}
            className="min-h-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          <span className="self-end text-[10px] text-muted-foreground">
            {corpo.length}/{LIMITE_CORPO}
          </span>
        </div>
        {nVariaveis > 0 && (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50/50 p-2 dark:border-amber-800/60 dark:bg-amber-950/20">
            <p className="text-[11px] text-amber-900 dark:text-amber-200">
              {t("A revisão exige um exemplo de cada valor. Sem eles o modelo é recusado.")}
            </p>
            {Array.from({ length: nVariaveis }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{`{{${i + 1}}}`}</span>
                <input
                  value={exemplos[i] ?? ""}
                  onChange={(e) => {
                    const proximo = [...exemplos];
                    proximo[i] = e.target.value;
                    setExemplos(proximo);
                  }}
                  placeholder={t("ex.: María")}
                  aria-label={`${t("Exemplo do valor")} ${i + 1}`}
                  className={`${CAMPO} h-8 flex-1`}
                />
              </div>
            ))}
          </div>
        )}
        <input
          value={rodape}
          onChange={(e) => setRodape(e.target.value.slice(0, LIMITE_RODAPE))}
          placeholder={t("Rodapé (opcional) — texto pequeno no fim da mensagem")}
          aria-label={t("Rodapé")}
          className={CAMPO}
        />
        <div className="flex flex-col gap-1.5">
          {respostas.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r}
                onChange={(e) => {
                  const proximas = [...respostas];
                  proximas[i] = e.target.value.slice(0, LIMITE_RESPOSTA_RAPIDA);
                  setRespostas(proximas);
                }}
                placeholder={t("Texto do botão")}
                aria-label={`${t("Resposta rápida")} ${i + 1}`}
                className={`${CAMPO} h-8 flex-1`}
              />
              <button
                type="button"
                onClick={() => setRespostas(respostas.filter((_, j) => j !== i))}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                {t("remover")}
              </button>
            </div>
          ))}
          {respostas.length < LIMITE_BOTOES && (
            <button
              type="button"
              onClick={() => setRespostas([...respostas, ""])}
              className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              + {t("Adicionar resposta rápida")} ({respostas.length}/{LIMITE_BOTOES})
            </button>
          )}
        </div>
        {problemas.map((p) => (
          <p key={`${p.campo}:${p.mensagem}`} className="text-xs text-destructive">
            {t(p.mensagem)}
          </p>
        ))}
        <p className="text-[11px] text-muted-foreground">
          {editando
            ? t(
                "Ao salvar, a plataforma revisa o modelo de novo. A Meta limita quantas vezes um modelo aprovado pode ser editado; se passar do limite, a resposta dela aparece aqui.",
              )
            : t("A plataforma revisa antes de aprovar — o modelo nasce pendente e some da lista de envio até ela decidir.")}
        </p>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onFechar}>
            {t("Cancelar")}
          </Button>
          <Button type="button" size="sm" disabled={!podeEnviar} onClick={() => void enviar()}>
            {editando ? t("Salvar e enviar para revisão") : t("Enviar para revisão")}
          </Button>
        </div>
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <PreviaDaDefinicao
          cabecalho={conteudo.cabecalho}
          midiaUrl=""
          corpo={corpo}
          rodape={rodape}
          botoes={conteudo.respostasRapidas.map((texto) => ({ tipo: "quick_reply" as const, texto }))}
        />
      </div>
    </div>
  );
}

/**
 * Editar e apagar um template da lista. Apagar pergunta antes e, se o template
 * estiver em uso (follow-up ou prompt do agente), mostra ONDE e pede a segunda
 * confirmação — a mesma regra das conexões por parceiro (`gestao-de-modelos.ts`).
 */
export function AcoesDoModeloOficial({ modelo, onEditar }: { modelo: ModeloEmEdicao; onEditar: () => void }) {
  const t = useT();
  const gerir = useGerirModeloOficial();
  const [apagando, setApagando] = useState<{ usos: string[] | null } | null>(null);
  const editavel = formularioDoModelo(modelo.components) !== null;

  async function apagar(confirmado: boolean) {
    try {
      await gerir.mutateAsync({ acao: "apagar", name: modelo.name, language: modelo.language, confirmado });
      toast.success(t("Modelo apagado."));
      setApagando(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "template_in_use") {
        const usos = Array.isArray(e.details?.usos) ? (e.details.usos as string[]) : [];
        setApagando({ usos });
        return;
      }
      toast.error(mensagemDaFalha(e, t("Não consegui falar com a plataforma.")));
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {editavel && (
        <Button type="button" variant="outline" size="sm" onClick={onEditar}>
          <PencilSimple size={14} className="mr-1.5" aria-hidden />
          {t("Editar")}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setApagando({ usos: null })}
      >
        <Trash size={14} className="mr-1.5" aria-hidden />
        {t("Apagar")}
      </Button>

      <AlertDialog open={apagando !== null} onOpenChange={(v) => !v && !gerir.isPending && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Apagar o modelo")} <span className="font-mono">{modelo.name}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Ele é apagado também na plataforma do WhatsApp, e não dá para desfazer. A Meta não deixa usar o mesmo nome de novo por 30 dias.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {apagando?.usos && apagando.usos.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50/50 p-2 text-sm dark:border-amber-800/60 dark:bg-amber-950/20">
              <p className="font-medium">{t("Este modelo está em uso:")}</p>
              <ul className="mt-1 list-disc pl-5">
                {apagando.usos.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Sem ele, esse passo do follow-up é pulado e o agente não consegue mandá-lo. Troque antes, ou apague assim mesmo.")}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={gerir.isPending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={gerir.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                // Não fecha sozinho: se a rota responder "em uso", o diálogo
                // continua aberto mostrando onde.
                e.preventDefault();
                void apagar(apagando?.usos !== null && apagando?.usos !== undefined);
              }}
            >
              {gerir.isPending
                ? t("Apagando…")
                : apagando?.usos && apagando.usos.length > 0
                  ? t("Apagar assim mesmo")
                  : t("Apagar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
