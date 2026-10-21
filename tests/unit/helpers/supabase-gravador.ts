/**
 * Supabase de mentira que GRAVA a cadeia de cada consulta (`from(...)`) e
 * responde o que o teste decidir. `responder` recebe a tabela e as chamadas
 * DAQUELA consulta (select/eq/in/insert/update...) e é chamado quando ela é
 * resolvida (`await`, `single`, `maybeSingle`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Chamada {
  tabela: string;
  metodo: string;
  args: unknown[];
}

export type Resposta = { data?: unknown; error?: { code?: string; message: string } | null };

export function supabaseGravador(responder: (tabela: string, chamadas: Chamada[]) => Resposta) {
  const log: Chamada[] = [];
  const rpcs: Array<{ fn: string; args: unknown }> = [];
  let respostaDoRpc: (fn: string, args: unknown) => Resposta = () => ({ data: null, error: null });

  const admin = {
    from(tabela: string) {
      const minhas: Chamada[] = [];
      const resolver = () => {
        const r = responder(tabela, minhas);
        return { data: r.data ?? null, error: r.error ?? null };
      };
      const cadeia: unknown = new Proxy(function cadeiaFalsa() {}, {
        get(_alvo, prop) {
          if (prop === "then") {
            return (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, falha);
          }
          if (prop === "single" || prop === "maybeSingle") return async () => resolver();
          return (...args: unknown[]) => {
            const chamada = { tabela, metodo: String(prop), args };
            minhas.push(chamada);
            log.push(chamada);
            return cadeia;
          };
        },
      });
      return cadeia;
    },
    async rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      const r = respostaDoRpc(fn, args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };

  return {
    admin: admin as unknown as SupabaseClient,
    log,
    rpcs,
    responderRpc(f: (fn: string, args: unknown) => Resposta) {
      respostaDoRpc = f;
    },
  };
}

/** A cadeia gravada tem esta chamada nesta tabela (args comparados por JSON)? */
export function usou(log: Chamada[], tabela: string, metodo: string, ...args: unknown[]): boolean {
  return log.some((c) => c.tabela === tabela && c.metodo === metodo && JSON.stringify(c.args) === JSON.stringify(args));
}
