/**
 * FALHA DE ENVIO QUE NÃO VOLTA NA FILA (caminho 1 do número oficial, fork).
 *
 * O turno da IA e o envio fixo do follow-up tratam `failed` como "tente de novo":
 * o job falha, a fila re-roda o turno inteiro (modelo incluso) até `max_attempts`
 * e, no fim, abre o `job_dead` crítico na Central. Duas falhas dão o MESMO
 * resultado em qualquer nova tentativa, e por isso encerram o job sem retry e sem
 * alerta:
 *   - 131070: outro app (o ManyChat) é o dono desta conversa;
 *   - a resposta automática desligada neste número (fork 9005).
 *
 * O erro é `terminal` — o contrato da fila em `workers/agent-worker/main.ts`
 * (`ehVetoPermanenteDeNegocio`): o worker cancela o job e loga `warn`, sem Sentry.
 * Nada aqui toca `force_human` nem o silêncio da conversa: a IA da conversa não
 * é pausada. Só sintaxe apagável (o worker roda em strip-types).
 */
import { conversaComOutroApp } from '@/lib/channels/meta/erros-para-operador';
import { RESPOSTA_AUTOMATICA_DESLIGADA } from '@/lib/channels/responde-sozinho';

import type { ChannelSendResult } from '../channel-adapter';

/** O motivo verdadeiro, na língua do `skipped` da inscrição (e do log). */
export function motivoSemNovaTentativa(codigo: string | null): string {
  return codigo === RESPOSTA_AUTOMATICA_DESLIGADA ? RESPOSTA_AUTOMATICA_DESLIGADA : 'conversa_com_outro_app';
}

export class EnvioSemNovaTentativaError extends Error {
  readonly terminal = true as const;
  override readonly name = 'envio_sem_nova_tentativa';
  // Sem param-property (o worker roda em strip-types).
  readonly motivo: string;
  constructor(message: string, motivo: string) {
    super(message);
    this.motivo = motivo;
  }
}

export function envioSemNovaTentativa(codigo: string | null, detalhe: string | null): boolean {
  return codigo === RESPOSTA_AUTOMATICA_DESLIGADA || conversaComOutroApp(codigo, detalhe);
}

/**
 * O erro que encerra o job quando o envio falhou: terminal se TODAS as falhas são
 * das que não mudam no retry; senão o de sempre, com a mensagem de sempre.
 */
export function erroDoEnvioQueFalhou(falhas: readonly ChannelSendResult[], mensagemDaNovaTentativa: string): Error {
  const semNovaTentativa =
    falhas.length > 0 &&
    falhas.every((o) => o.kind === 'failed' && envioSemNovaTentativa(o.erro?.codigo ?? null, o.erro?.detalhe ?? null));
  if (!semNovaTentativa) return new Error(mensagemDaNovaTentativa);
  const codigos = falhas.map((o) => (o.kind === 'failed' ? (o.erro?.codigo ?? '') : '')).join(',');
  const primeira = falhas[0];
  const motivo = motivoSemNovaTentativa(primeira?.kind === 'failed' ? (primeira.erro?.codigo ?? null) : null);
  return new EnvioSemNovaTentativaError(`envio sem nova tentativa (${codigos}) — job encerrado sem retry`, motivo);
}
