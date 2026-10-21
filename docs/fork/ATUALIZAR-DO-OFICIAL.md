# Trazer uma versão nova do oficial para este fork

Este fork tem mudanças que o oficial não tem, cada uma numa migration da faixa
**9000**: a **9001** (`supabase/migrations/20261021130704_9001_campanha_com_template.sql`,
colunas novas em `campaigns`) e, a partir da Parte 1 do motor de fluxo, a **9002**
(`supabase/migrations/20261021150000_9002_etiquetas_e_campos_do_fluxo.sql`, funções de
tirar etiqueta e gravar campo) e, a partir da Parte 2, a **9003** (`supabase/migrations/20261021180903_9003_entrada_das_vendas.sql`, conexões e eventos de venda).

O número 9001 é de propósito. O oficial numera as migrations em sequência (0703,
0704, 0705...). Se a nossa usasse o próximo número da fila, a próxima versão do
oficial ia trazer uma migration com o mesmo número e os testes reprovariam. A faixa
9000 fica reservada para o fork, longe da fila deles.

Os arquivos abaixo existem só para esta instalação. **Não entram em nenhum PR para o
oficial:**

- `supabase/migrations/20261021130704_9001_campanha_com_template.sql`
- `supabase/migrations/20261021150000_9002_etiquetas_e_campos_do_fluxo.sql`
- `supabase/migrations/20261021180903_9003_entrada_das_vendas.sql`
- `supabase/fork/9NNN.sql` (cópia exata de cada bloco que vai no `baseline.sql`)
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

3. **Conflito no `supabase/baseline.sql`.** É o conflito esperado: o oficial
   acrescentou coisas no arquivo e nós também. Fique com a versão deles e
   recoloque os nossos blocos:

   ```bash
   git checkout --theirs supabase/baseline.sql   # no merge
   # no rebase o lado do oficial é o "ours":
   # git checkout --ours supabase/baseline.sql
   bash scripts/fork/reaplicar-bloco-do-fork.sh
   git add supabase/baseline.sql
   ```

   O script reaplica TODOS os blocos de `supabase/fork/`, em ordem: bloco sem função
   vai no fim; bloco com função (como o 9002) entra logo antes do bloco
   `-- ---- VARREDURA anon:` — depois dela, a função nasceria exposta à anon key.
   Bloco que já está lá é pulado. Nunca edite um bloco à mão no baseline: se precisar
   mudar, mude a migration, o `supabase/fork/9NNN.sql` e o baseline juntos.

4. **Confira se o oficial lançou a própria campanha com template.** Procure se a
   versão nova já cria alguma das colunas `message_mode`, `template_name`,
   `template_language`, `template_contract_hash` ou `template_slot_map` em
   `campaigns`:

   ```bash
   git grep -n "message_mode\|template_slot_map\|template_contract_hash" -- supabase/migrations ':!*9001*'
   ```

   Confira também se o oficial lançou as próprias funções de tirar etiqueta e gravar
   campo (as da 9002):

   ```bash
   git grep -n "fn_contato_remover_etiquetas\|fn_lead_remover_etiquetas\|fn_contato_anotar_campos" -- supabase/migrations ':!*9002*'
   ```

   A 9003 recria `emit_event` e `fn_service_event_contact` a partir da 0670 (com
   `sale.received` acrescentado). Se a versão nova do oficial redefinir qualquer
   uma das duas, `tests/unit/fork-9003-entrada-das-vendas.test.ts` fica vermelho
   ("a 0670 ainda é a última..."). Aí refaça o Passo 4 da Tarefa 1 do plano da
   Parte 2 a partir da migration NOVA do oficial (troque o nome do arquivo no
   script e na cerca) antes de aplicar qualquer coisa:

   ```bash
   git grep -n "function public.emit_event(\|function public.fn_service_event_contact(" -- supabase/migrations ':!*9003*'
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
     tests/unit/blocos-do-fork.test.ts \
     tests/unit/fork-9002-etiquetas-e-campos.test.ts \
     tests/unit/fork-9003-entrada-das-vendas.test.ts \
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
