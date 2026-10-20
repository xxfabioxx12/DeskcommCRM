/**
 * Gestão das definições aprovadas numa API Graph-compatível — listar, criar,
 * editar e apagar —, escrita UMA vez para os dois donos que falam a mesma Cloud
 * API: o canal oficial direto (`template-ops.ts`) e o parceiro Graph-compatível
 * (`../graph-parceiro/templates.ts`). Mudam só a base, a credencial e o prefixo do
 * erro; caminhos e corpos são os da plataforma:
 *
 *   - listar: GET    /{waba_id}/message_templates?limit=100&fields=…
 *   - criar:  POST   /{waba_id}/message_templates
 *   - editar: POST   /{template_id}          (o id da VARIANTE, sem o waba)
 *   - apagar: DELETE /{waba_id}/message_templates?name=…&hsm_id=…
 *
 * Os `components` chegam prontos em MAIÚSCULA (`BODY`, `HEADER`…), que é como a
 * Graph espera, e viajam crus: são a entrada de quem deriva o contrato.
 *
 * ─── Editar e apagar por VARIANTE (#1734) ───────────────────────────────────
 * A plataforma numera cada variante de idioma por conta própria; por nome só, o
 * DELETE leva TODAS. Por isso editar e apagar resolvem antes o id da variante
 * (nome + idioma) e, sem ele, lançam em vez de chamar a plataforma no escuro.
 */
import type { ChannelTemplate, ChannelTemplateOps, ChannelTenantScope } from "../types";

export interface CredenciaisDosModelos {
  wabaId: string;
  token: string;
  /** Só o oficial usa: a versão vai na base (`graphBaseUrl(versao)`). */
  graphVersion?: string;
}

type Escopo = ChannelTenantScope & { sessionRef: string };

export interface ConfiguracaoDosModelosGraph {
  /** Prefixo dos erros: `graph_partner` → `graph_partner_template_failed: …`. */
  prefixo: string;
  /** Base com versão e sem barra final. */
  base(c: CredenciaisDosModelos): string;
  /** Organização + número: as duas pontas que identificam a sessão (issue #236). Lança sem credencial. */
  credenciais(escopo: Escopo): Promise<CredenciaisDosModelos>;
  /**
   * O texto da recusa que vai depois do status. Sem esta opção, só
   * `error.message` — o comportamento de sempre do parceiro. O oficial passa
   * `error_user_msg ?? message`, a frase que a plataforma escreve para gente.
   */
  textoDoErro?(erro: ErroDaGraph | undefined): string | undefined;
}

/** O `error` do corpo de uma recusa da Graph. */
export interface ErroDaGraph {
  message?: string;
  error_user_msg?: string;
}

/** A forma que a Graph devolve. */
interface RawTemplate {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string | null;
  components?: unknown[];
  rejected_reason?: string | null;
  parameter_format?: string | null;
  error?: ErroDaGraph;
}

const CAMPOS_DA_LISTA =
  "name,language,status,category,parameter_format,rejected_reason,quality_score,components";

function toNeutral(t: RawTemplate | null): ChannelTemplate {
  const componentes = t?.components;
  return {
    name: t?.name ?? "",
    language: t?.language ?? "",
    // Vocabulário ABERTO: a plataforma cria estado novo sem avisar.
    status: t?.status ?? "UNKNOWN",
    category: t?.category ?? null,
    components: Array.isArray(componentes) ? componentes : [],
    rejectedReason: t?.rejected_reason ?? null,
    parameterFormat: t?.parameter_format ?? null,
  };
}

async function lerJson(res: Response): Promise<RawTemplate | null> {
  return (await res.json().catch(() => null)) as RawTemplate | null;
}

export function criarOpsDeModelosGraph(cfg: ConfiguracaoDosModelosGraph): ChannelTemplateOps {
  /**
   * O texto da recusa que CHEGA ao operador, escolhido por `cfg.textoDoErro`
   * (padrão: só `error.message`). Nunca carrega o token (vai no header).
   */
  function erroDaGraph(res: Response, json: RawTemplate | null): Error {
    const erro = json?.error;
    const texto = (cfg.textoDoErro ? cfg.textoDoErro(erro) : erro?.message) ?? "";
    return new Error(`${cfg.prefixo}_template_failed: ${res.status} ${texto}`.trim());
  }

  function mesmaOrigem(url: string, c: CredenciaisDosModelos): boolean {
    try {
      return new URL(url).origin === new URL(cfg.base(c)).origin;
    } catch {
      return false;
    }
  }

  /**
   * Varre a coleção, uma página por vez, até o fim ou até `emCada` pedir para
   * parar. `paging.next` só é seguido no MESMO host (o token vai no header, e um
   * `next` apontando para fora o entregaria a quem a resposta mandasse); o teto de
   * páginas fecha o laço se a plataforma devolver sempre o mesmo cursor.
   */
  async function varrerModelos(
    c: CredenciaisDosModelos,
    fields: string,
    emCada: (t: RawTemplate) => boolean,
    nome?: string,
  ): Promise<void> {
    // `name` é filtro documentado e devolve o nome em TODOS os idiomas — daí o
    // idioma casar aqui dentro e não no servidor.
    const filtro = nome ? `&name=${encodeURIComponent(nome)}` : "";
    let url: string | null =
      `${cfg.base(c)}/${encodeURIComponent(c.wabaId)}/message_templates?limit=100&fields=${fields}${filtro}`;

    for (let pagina = 0; pagina < 50 && url; pagina += 1) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${c.token}` } });
      const json = (await res.json().catch(() => null)) as
        | (RawTemplate & { data?: RawTemplate[]; paging?: { next?: string } })
        | null;
      if (!res.ok || json?.error) throw erroDaGraph(res, json);
      for (const t of json?.data ?? []) {
        if (!emCada(t)) return;
      }
      const proxima = json?.paging?.next;
      url = proxima && proxima !== url && mesmaOrigem(proxima, c) ? proxima : null;
    }
  }

  /** O id da UMA variante — nome e idioma JUNTOS. Sem ele, nada sai daqui. */
  async function idDaVariante(c: CredenciaisDosModelos, name: string, language: string): Promise<string> {
    const achados: string[] = [];
    await varrerModelos(
      c,
      "id,name,language",
      (t) => {
        if (t.id && t.name === name && t.language === language) {
          achados.push(t.id);
          return false;
        }
        return true;
      },
      name,
    );
    const id = achados[0];
    if (!id) {
      throw new Error(`${cfg.prefixo}_template_variante_ausente: ${name} (${language}) não está nesta conta.`);
    }
    return id;
  }

  /** POST num caminho relativo à base. Devolve o que a plataforma devolver (pode vir vazio). */
  async function postar(
    c: CredenciaisDosModelos,
    caminho: string,
    body: Record<string, unknown>,
  ): Promise<ChannelTemplate> {
    const res = await fetch(`${cfg.base(c)}${caminho}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await lerJson(res);
    if (!res.ok || json?.error) throw erroDaGraph(res, json);
    return toNeutral(json);
  }

  return {
    async list(escopo): Promise<ChannelTemplate[]> {
      const c = await cfg.credenciais(escopo);
      const todos: ChannelTemplate[] = [];
      await varrerModelos(c, CAMPOS_DA_LISTA, (t) => {
        todos.push(toNeutral(t));
        return true;
      });
      return todos;
    },

    async create({ organizationId, sessionRef, draft }): Promise<ChannelTemplate> {
      const c = await cfg.credenciais({ organizationId, sessionRef });
      return postar(c, `/${encodeURIComponent(c.wabaId)}/message_templates`, {
        name: draft.name,
        language: draft.language,
        category: draft.category,
        components: draft.components,
        ...(draft.parameterFormat ? { parameter_format: draft.parameterFormat } : {}),
      });
    },

    /**
     * Edita a VARIANTE pelo id: `POST /{template_id}`. Nome e idioma só ACHAM o
     * id — a plataforma não os deixa mudar. A resposta não traz o idioma, então
     * ele vem de quem chamou.
     */
    async update({ organizationId, sessionRef, name, language, patch }): Promise<ChannelTemplate> {
      const c = await cfg.credenciais({ organizationId, sessionRef });
      const id = await idDaVariante(c, name, language);
      const editado = await postar(c, `/${encodeURIComponent(id)}`, {
        ...(patch.category ? { category: patch.category } : {}),
        ...(patch.components ? { components: patch.components } : {}),
      });
      return { ...editado, language };
    },

    /** Apaga UMA variante: o id dela em `hsm_id`, o nome em `name` (os dois juntos). */
    async remove({ organizationId, sessionRef, name, language }): Promise<void> {
      const c = await cfg.credenciais({ organizationId, sessionRef });
      const id = await idDaVariante(c, name, language);
      const url = `${cfg.base(c)}/${encodeURIComponent(c.wabaId)}/message_templates?name=${encodeURIComponent(name)}&hsm_id=${encodeURIComponent(id)}`;
      const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${c.token}` } });
      if (!res.ok) throw erroDaGraph(res, await lerJson(res));
    },
  };
}
