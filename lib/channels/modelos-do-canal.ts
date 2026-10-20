/**
 * QUEM GERENCIA TEMPLATES PELA TELA — decidido pela CAPACIDADE do canal
 * (`canManageTemplates`) e pela presença das operações no adapter, nunca pelo
 * nome do provider fora daqui (invariante 1 de `docs/doctrine/restricao-de-canal.md`).
 */
import { CHANNEL_PROVIDER_META, capabilitiesOf, transportaMensagem, type ChannelProvider } from "./capabilities";
import { getAdapter } from "./index";
import type { ChannelTemplateOps } from "./types";

export function opsDeModelosDoCanal(provider: string | null | undefined): ChannelTemplateOps | null {
  if (!provider || !transportaMensagem(provider)) return null;
  if (!capabilitiesOf(provider as ChannelProvider).canManageTemplates) return null;
  return getAdapter(provider as ChannelProvider).templates ?? null;
}

/**
 * As operações da conta oficial que `metaSessionForOrg` resolve (a rota
 * `/api/v1/channels/templates` só serve esse canal). O nome do provider fica
 * aqui dentro; a rota pergunta só "gerencia?".
 */
export function opsDeModelosDaContaOficial(): ChannelTemplateOps | null {
  return opsDeModelosDoCanal(CHANNEL_PROVIDER_META);
}
