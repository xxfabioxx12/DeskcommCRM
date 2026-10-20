# Trazer uma versão nova do oficial para este fork

Este fork tem uma mudança que o oficial não tem: a campanha com template aprovado
da Meta. Ela precisa de colunas novas na tabela `campaigns`, criadas pela migration
**9001** (`supabase/migrations/20261021130704_9001_campanha_com_template.sql`).

O número 9001 é de propósito. O oficial numera as migrations em sequência (0703,
0704, 0705...). Se a nossa usasse o próximo número da fila, a próxima versão do
oficial ia trazer uma migration com o mesmo número e os testes reprovariam. A faixa
9000 fica reservada para o fork, longe da fila deles.

Os arquivos abaixo existem só para esta instalação. **Não entram em nenhum PR para o
oficial:**

- `supabase/migrations/20261021130704_9001_campanha_com_template.sql`
- `supabase/fork/9001.sql` (cópia exata do bloco que vai no fim do `baseline.sql`)
- `scripts/fork/reaplicar-bloco-do-fork.sh`
- este documento

## Passo a passo

1. **Backup antes de tudo.** Faça backup do banco do Supabase de produção antes de
   aplicar qualquer coisa nele (`scripts/backup-db.sh` ou o backup do painel do
   Supabase). Sem backup, não siga.

2. **Traga a versão nova do oficial.** Troque `vX.Y.Z` pela versão:

   ```bash
   git fetch origin --tags
   git switch -c atualiza-vX.Y.Z
   git rebase vX.Y.Z      # ou: git merge vX.Y.Z
   ```

3. **Conflito no fim do `supabase/baseline.sql`.** É o conflito esperado: o oficial
   acrescentou coisas no fim do arquivo e nós também. Fique com a versão deles e
   recoloque o nosso bloco no fim:

   ```bash
   git checkout --theirs supabase/baseline.sql   # no merge
   # no rebase o lado do oficial é o "ours":
   # git checkout --ours supabase/baseline.sql
   bash scripts/fork/reaplicar-bloco-do-fork.sh
   git add supabase/baseline.sql
   ```

   O script só acrescenta o bloco se ele não estiver lá, igual ao que está em
   `supabase/fork/9001.sql`. Nunca edite o bloco à mão no baseline: se precisar
   mudar, mude a migration, o `supabase/fork/9001.sql` e o baseline juntos.

4. **Confira se o oficial lançou a própria campanha com template.** Procure se a
   versão nova já cria alguma das colunas `message_mode`, `template_name`,
   `template_language`, `template_contract_hash` ou `template_slot_map` em
   `campaigns`:

   ```bash
   git grep -n "message_mode\|template_slot_map\|template_contract_hash" -- supabase/migrations ':!*9001*'
   ```

   Se aparecer alguma coisa, **pare**. Não aplique nada no banco. As duas versões
   precisam ser conciliadas antes (qual coluna fica, qual código fica), e isso é
   trabalho de desenvolvimento, não de atualização.

5. **Rode as conferências.** Todas precisam passar:

   ```bash
   bash scripts/checar-colisao-de-migration.sh
   pnpm vitest run tests/unit/apendice-do-baseline-espelha-a-migration.test.ts \
     tests/unit/apendice-do-baseline-nao-diverge-da-cadeia.test.ts \
     tests/unit/manifest-x-migrations.test.ts \
     tests/unit/main-sem-migration-duplicada.test.ts \
     tests/unit/campanha-template-migration.test.ts \
     tests/unit/baseline-reaplicavel.test.ts
   pnpm cercas
   pnpm test:unit
   ```

   O `checar-colisao-de-migration.sh` precisa de internet para olhar os PRs abertos
   do oficial; sem rede, ele mede só o que está no clone.

6. **Aplique no banco.** Com o backup feito, siga o caminho normal de atualização
   (`docs/ATUALIZANDO.md`). A migration 9001 só acrescenta colunas e pode rodar mais
   de uma vez sem estragar nada.

## Se der errado

- Teste de baseline reprovando por causa do bloco 9001: confira se o bloco está no
  fim do arquivo e igual ao `supabase/fork/9001.sql` (rode o script de novo).
- Colisão de número 9001 ou do timestamp `20261021130704`: o oficial nunca deve chegar
  na faixa 9000. Se chegar, renumere para outro número da faixa 9000 com outro
  timestamp e atualize migration, `supabase/fork/9001.sql`, baseline, testes e este
  documento juntos.

## Nomes das imagens deste fork

A conta xxfabioxx12 já publica `deskcommcrm`, `deskcomm-worker` e `deskcomm-scheduler` a partir de outro repositório (o Deskcomm FV, da barbearia). Para as imagens da NODZ nunca sobrescreverem aquelas, a automação `publish-image.yml` acrescenta ao nome o valor da variável de repositório `SUFIXO_DA_IMAGEM`. Neste fork ela vale `-nodz`, então as imagens saem como `ghcr.io/xxfabioxx12/deskcommcrm-nodz`, `deskcomm-worker-nodz`, `deskcomm-scheduler-nodz` e `deskcomm-voice-agent-nodz`. Sem a variável (como no projeto oficial) os nomes ficam iguais aos de sempre. Ao atualizar do oficial, se o `publish-image.yml` der conflito, mantenha o `${{ vars.SUFIXO_DA_IMAGEM }}` nas cinco linhas de nome de imagem.
