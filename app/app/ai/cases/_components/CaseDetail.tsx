"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { format, formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useCase, useConcluirCaso } from "@/hooks/ai/useCases";
import { useConversaDoCaso } from "@/hooks/ai/useConversaDoCaso";
import { STATUS_BADGE_VARIANT, STATUS_LABEL, caseEventLabel } from "@/lib/ai/case-copy";
import type { Message } from "@/lib/types/messaging";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/i18n/useT";
import { CaseChatPanel } from "./CaseChatPanel";
import { CaseReplyPanel } from "./CaseReplyPanel";

const ABERTOS = new Set(["awaiting_human", "awaiting_lead"]);

/**
 * Fork NODZ — o caso numa tela só, na ordem em que se decide:
 *   1. quem é + botão "Concluído" (fecha SEM mandar mensagem ao cliente);
 *   2. o que o cliente precisa / por que a IA travou;
 *   3. o ATENDIMENTO inteiro (as mensagens da conversa), para ler sem sair daqui;
 *   4. "Mais opções", recolhido: responder pela IA, perguntar à IA e linha do tempo.
 *
 * Dentro de "Mais opções" a ordem reply → chat continua a de antes (contrato
 * de `tests/unit/case-detail.test.tsx` e de `escalacao-ciclo.spec.ts`, que acha
 * o campo de decisão por `page.locator("textarea").first()`).
 */
export function CaseDetail({
  caseId,
  onConcluido,
}: {
  caseId: string | null;
  onConcluido?: (caseId: string) => void;
}) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const { data, isLoading } = useCase(caseId);
  const concluir = useConcluirCaso();
  const [confirmando, setConfirmando] = useState(false);
  const [nota, setNota] = useState("");

  if (caseId === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 py-16 text-center">
        <p className="text-sm font-medium">{t("Selecione um caso à esquerda")}</p>
        <p className="text-xs text-muted-foreground">{t("O atendimento e o botão de concluir aparecem aqui.")}</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const aberto = ABERTOS.has(data.status);

  const confirmarConclusao = () => {
    concluir.mutate(
      { id: data.id, note: nota.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(t("Caso fechado. Nenhuma mensagem foi enviada ao cliente."));
          setConfirmando(false);
          setNota("");
          onConcluido?.(data.id);
        },
        onError: () => {
          toast.error(t("Não deu para fechar o caso. Ele pode já ter sido fechado por outra pessoa."));
          setConfirmando(false);
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto break-words">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{data.contact_name ?? t("Contato sem nome")}</h2>
          <p className="text-xs text-muted-foreground">{data.contact_phone ?? t("Sem telefone")}</p>
          <Link
            className="relative text-xs underline underline-offset-4 pointer-coarse:inline-block pointer-coarse:before:absolute pointer-coarse:before:-inset-3.5 pointer-coarse:before:content-['']"
            href={`/app/inbox/${data.conversation_id}`}
          >
            {t("Ver conversa")}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.source === "guardrail_autofallback" ? (
            <Badge
              variant="neutral"
              title={t(
                "Aberto automaticamente pelo sistema — a IA prometeu passar pra humano mas não abriu o caso, então o sistema abriu por ela.",
              )}
            >
              {t("Aberto automaticamente")}
            </Badge>
          ) : null}
          <Badge variant={STATUS_BADGE_VARIANT[data.status]}>{t(STATUS_LABEL[data.status])}</Badge>
          {aberto ? (
            <Button
              size="sm"
              data-testid="concluir-caso"
              disabled={concluir.isPending}
              title={t("Já vi, já foi respondido: fecha o caso sem mandar mensagem ao cliente.")}
              onClick={() => setConfirmando(true)}
            >
              {t("Concluído")}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("O que o cliente precisa")}</p>
          <p className="mt-1 text-sm">{data.summary}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("Por que a IA travou")}</p>
          <p className="mt-1 text-sm">{data.blocker}</p>
        </div>
      </div>

      <AtendimentoDoCaso conversationId={data.conversation_id} />

      <details className="rounded-lg border border-border p-3" data-testid="mais-opcoes-do-caso">
        <summary className="cursor-pointer text-sm font-medium">{t("Mais opções")}</summary>
        <div className="mt-3 flex flex-col gap-4">
          <CaseReplyPanel caseId={data.id} status={data.status} />

          {/* DEPOIS da decisão, e a ordem é CONTRATO (ver comentário do componente). */}
          <CaseChatPanel caseId={data.id} />

          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("Linha do tempo")}</h3>
            <ul className="space-y-2">
              {data.events.map((ev) => (
                <li key={ev.id} className="text-xs text-muted-foreground">
                  <span className="text-text">{t(caseEventLabel(ev))}</span>
                  {ev.body ? <>: {ev.body}</> : null}
                  {" · "}
                  {formatDistanceToNowStrict(new Date(ev.created_at), { addSuffix: true, locale: localeDaData })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      <AlertDialog open={confirmando} onOpenChange={(v) => !concluir.isPending && setConfirmando(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Fechar este caso?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Ele sai da fila e vai para Fechados. Nenhuma mensagem é enviada ao cliente.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder={t("Nota interna (opcional)")}
            maxLength={4000}
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={concluir.isPending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={concluir.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmarConclusao();
              }}
            >
              {concluir.isPending ? t("Fechando...") : t("Concluído")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function textoDaMensagem(m: Message, t: (s: string) => string): string {
  if (m.revoked_at) return t("(mensagem apagada)");
  if (m.body && m.body.trim()) return m.body;
  if (m.media_derived_text && m.media_derived_text.trim()) return m.media_derived_text;
  if (m.type && m.type !== "text") return `[${m.type}]`;
  return t("(sem texto)");
}

function quemEnviou(m: Message, t: (s: string) => string): string {
  if (m.direction !== "outbound") return t("Cliente");
  if (m.sent_via === "ai") return t("IA");
  if (m.sent_via === "automation") return t("Automação");
  if (m.sent_via === "system") return t("Sistema");
  return t("Equipe");
}

/** Fork NODZ — as mensagens da conversa do caso, só leitura. */
function AtendimentoDoCaso({ conversationId }: { conversationId: string }) {
  const t = useT();
  const { data, isLoading, isError } = useConversaDoCaso(conversationId);

  return (
    <section data-testid="atendimento-do-caso" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("Atendimento")}</h3>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError || !data ? (
        <p className="text-xs text-muted-foreground">{t("Não deu para carregar as mensagens. Abra a conversa no Inbox.")}</p>
      ) : data.mensagens.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("Nenhuma mensagem nesta conversa.")}</p>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border p-3">
          {data.temMais ? (
            <p className="mb-2 text-center text-xs text-muted-foreground">
              {t("Mostrando as 100 mensagens mais recentes. O histórico completo fica no Inbox.")}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {data.mensagens.map((m) => {
              const saida = m.direction === "outbound";
              return (
                <li key={m.id} className={cn("flex", saida ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      saida ? "bg-accent-soft" : "border border-border",
                    )}
                  >
                    <p className="mb-0.5 text-[11px] text-muted-foreground">
                      {quemEnviou(m, t)} · {format(new Date(m.sent_at), "dd/MM HH:mm")}
                    </p>
                    <p className="whitespace-pre-wrap">{textoDaMensagem(m, t)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
