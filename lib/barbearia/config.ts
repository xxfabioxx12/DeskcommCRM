/** Opt-in por organização. Ausência, false e valores inválidos não ativam o painel. */
export function painelBarbeariaLigado(settings: unknown): boolean {
  return (
    typeof settings === "object" &&
    settings !== null &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>).painel_barbearia === true
  );
}
export const DESTINOS_BARBEARIA = {
  agenda: "/app/agenda",
  servicos: "/app/settings/tenant/agenda",
  equipe: "/app/team",
  comandas: "/app/comandas",
  caixa: "/app/faturamento",
  conversas: "/app/inbox",
} as const;

/** O chat é independente do painel: só muda com consentimento explícito da organização. */
export function chatBarbeariaLigado(settings: unknown): boolean {
  return (
    typeof settings === "object" &&
    settings !== null &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>).chat_barbearia === true
  );
}
