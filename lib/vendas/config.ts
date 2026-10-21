/**
 * A `config` de uma conexão de venda (`webhook_sources.config`, fork 9003) e os
 * corpos de criar/editar. Porte do `config` de `PlatformConnection` do
 * integrador: `telefone_regiao`, `seguranca` ({modo, header, tolerancia_s}) e
 * `mapa` (o "Mapear campos" da conexão personalizada, `MapaCampos.php`).
 * `dispara` é o estado da spec: ausente/false = só registrando.
 */
import { z } from "zod";

import { PLATAFORMAS_DE_VENDA, eventoValido } from "./eventos";
import { REGIOES_DO_TELEFONE } from "./telefone";

const caminho = z.string().trim().min(1).max(200);
const caminhos = z.union([caminho, z.array(caminho).min(1).max(5)]);

/** Nome de campo livre (`{{venda.extra.nome}}`): `MapaCampos::nomeExtra` = slug com `_`. */
export const NOME_DO_EXTRA = /^[a-z0-9_]{1,60}$/;

export const mapaDaPersonalizadaSchema = z
  .object({
    evento: z
      .union([
        z.object({ fixo: z.string().trim().min(1).max(100) }).strict(),
        z
          .object({
            path: caminho,
            map: z.record(z.string().max(200), z.string().trim().min(1).max(100)).optional(),
          })
          .strict(),
      ])
      .optional(),
    nome: caminhos.optional(),
    email: caminhos.optional(),
    telefone: caminhos.optional(),
    produto_id: caminhos.optional(),
    produto_nome: caminhos.optional(),
    checkout_url: caminhos.optional(),
    id_evento: caminhos.optional(),
    entity: caminhos.optional(),
    teste: caminhos.optional(),
    moeda: z
      .union([caminhos, z.object({ fixo: z.string().trim().min(1).max(10) }).strict()])
      .optional(),
    valor: z
      .union([
        caminhos,
        z.object({ path: caminhos, formato: z.enum(["reais", "centavos"]).optional() }).strict(),
      ])
      .optional(),
    extras: z.record(z.string().regex(NOME_DO_EXTRA), caminhos).optional(),
  })
  .strict()
  .superRefine((mapa, ctx) => {
    // `CanonicalEvents::valido` na hora de salvar: evento fora do vocabulário seria regra que nunca casa.
    const ev = mapa.evento;
    const usados = !ev ? [] : "fixo" in ev ? [ev.fixo] : Object.values(ev.map ?? {});
    for (const evento of usados) {
      if (!eventoValido(evento, "personalizada")) {
        ctx.addIssue({
          code: "custom",
          path: ["evento"],
          message: `Evento desconhecido: ${evento}`,
        });
      }
    }
  });
export type MapaDaPersonalizada = z.infer<typeof mapaDaPersonalizadaSchema>;

export const segurancaSchema = z
  .object({
    modo: z.enum(["nenhuma", "header_igual", "stripe_t_v1"]),
    header: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    tolerancia_s: z.number().int().min(0).max(86_400).optional(),
  })
  .strict();

export const configDaConexaoSchema = z
  .object({
    dispara: z.boolean().optional(),
    telefone_regiao: z.enum(REGIOES_DO_TELEFONE).optional(),
    seguranca: segurancaSchema.optional(),
    mapa: mapaDaPersonalizadaSchema.optional(),
  })
  .strict();
export type ConfigDaConexao = z.infer<typeof configDaConexaoSchema>;

/**
 * A config gravada, lida com tolerância: torta vira `{}` — só registrando, região BR (falha
 * fechada). A `seguranca` é lida à parte: um campo torto em outro lugar não pode apagá-la
 * (sem ela a personalizada cairia em "nenhuma" e aceitaria qualquer corpo).
 */
export function configDaConexao(bruto: unknown): ConfigDaConexao {
  const lida = configDaConexaoSchema.safeParse(bruto ?? {});
  if (lida.success) return lida.data;
  const seguranca = segurancaSchema.safeParse((bruto as { seguranca?: unknown } | null)?.seguranca);
  return seguranca.success ? { seguranca: seguranca.data } : {};
}

const segredo = z.string().trim().min(4).max(500);

export const criarConexaoDeVendaSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(PLATAFORMAS_DE_VENDA),
    secret: segredo.nullish(),
    config: configDaConexaoSchema.optional(),
  })
  .superRefine((corpo, ctx) => {
    // Só a personalizada sem validação dispensa segredo (F4).
    const precisa =
      corpo.kind !== "personalizada" || (corpo.config?.seguranca?.modo ?? "nenhuma") !== "nenhuma";
    if (precisa && !corpo.secret)
      ctx.addIssue({ code: "custom", path: ["secret"], message: "Segredo obrigatório" });
  });

export const atualizarConexaoDeVendaSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** `null` apaga o segredo; ausente mantém o que existe. */
  secret: segredo.nullable().optional(),
  config: configDaConexaoSchema.optional(),
});
