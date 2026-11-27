# Trazer uma versão nova do oficial para este fork

Este fork tem mudanças que o oficial não tem, cada uma numa migration da faixa
**9000**: a **9001** (`supabase/migrations/20261021130704_9001_campanha_com_template.sql`,
colunas novas em `campaigns`) e, a partir da Parte 1 do motor de fluxo, a **9002**
(`supabase/migrations/20261021150000_9002_etiquetas_e_campos_do_fluxo.sql`, funções de
tirar etiqueta e gravar campo) e, a partir da Parte 2, a **9003** (`supabase/migrations/20261021180903_9003_entrada_das_vendas.sql`, conexões e eventos de venda) e, a partir da Parte 2b, a **9004** (`supabase/migrations/20261022141357_9004_reprocessar_vendas.sql`, nova tentativa das vendas que falharam) e, a partir do caminho 1 do número oficial, a **9005** (`supabase/migrations/20261022173418_9005_numero_oficial.sql`, conta de mensagens e resposta automática em `channel_sessions`).

O número 9001 é de propósito. O oficial numera as migrations em sequência (0703,
0704, 0705...). Se a nossa usasse o próximo número da fila, a próxima versão do
oficial ia trazer uma migration com o mesmo número e os testes reprovariam. A faixa
9000 fica reservada para o fork, longe da fila deles.

Os arquivos abaixo existem só para esta instalação. **Não entram em nenhum PR para o
oficial:**

- `supabase/migrations/20261021130704_9001_campanha_com_template.sql`
- `supabase/migrations/20261021150000_9002_etiquetas_e_campos_do_fluxo.sql`
- `supabase/migrations/20261021180903_9003_entrada_das_vendas.sql`
- `supabase/migrations/20261022141357_9004_reprocessar_vendas.sql`
- `supabase/migrations/20261022173418_9005_numero_oficial.sql`
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
     tests/unit/fork-9004-reprocessar-vendas.test.ts \
     tests/unit/fork-9005-numero-oficial.test.ts \
     tests/unit/baseline-reaplicavel.test.ts
   pnpm cercas
   pnpm test:unit
   ```

   O `checar-colisao-de-migration.sh` precisa de internet para olhar os PRs abertos
   do oficial; sem rede, ele mede só o que está no clone.

6. **Aplique no banco.** Com o backup feito, siga o caminho normal de atualização
   (`docs/ATUALIZANDO.md`). A migration 9001 só acrescenta colunas e pode rodar mais
   de uma vez sem estragar nada.

   **A 9004 entra no banco ANTES da troca das imagens.** Ela acrescenta as colunas de
   tentativa em `sales_events` e termina com `notify pgrst, 'reload schema';`, que faz a
   API do banco enxergar as colunas novas. A imagem nova lê e grava essas colunas em toda
   venda que chega: se ela subir num banco ainda sem a 9004, **toda venda recebida dá
   erro 500** até a migration entrar. Ordem: backup, 9004 aplicada (com o reload), só
   então as imagens novas.

   **A 9005 também entra ANTES das imagens.** A credencial do canal oficial, a sessão
   do webhook oficial e a tela da conexão oficial leem `meta_messaging_account_id`:
   numa imagem nova sobre um banco sem a 9005, o número oficial para de enviar e de
   receber até a migration entrar. Os números por QR Code não dependem dela. Antes,
   confira quais conexões oficiais existem (`select id, organization_id, display_name,
   status from channel_sessions where provider = 'meta_cloud' and archived_at is null;`):
   todas ficam com a resposta automática DESLIGADA até alguém ligar na tela.

   **Troque as imagens `web`, `agent-worker` e `scheduler` sempre JUNTAS.** Só a imagem
   nova conhece o interruptor "Responder automaticamente por este número". Uma `web`
   nova com um `agent-worker` velho envia pelo caminho antigo, embutido no worker, que
   não olha o interruptor.

   **Desfazer (voltar às imagens antigas):**
   - **Antes da Fase 3** (a Meta ainda não liberou a permissão de envio): voltar as
     imagens é inofensivo. A imagem velha não lê nem grava as colunas da 9005, e todo
     envio automático pelo oficial é recusado pela própria Meta.
   - **Depois da Fase 3, NÃO é inofensivo.** A imagem velha ignora o interruptor: IA,
     regras, follow-ups e "digitando…" voltariam a sair pelo número oficial junto com o
     ManyChat. Antes de voltar as imagens, pause a IA no número oficial em
     **Conexões › número oficial › Configurar acesso da IA** (modo "IA pausada"); a
     imagem velha respeita essa pausa. Só então troque as imagens (de novo, todas
     juntas). Para religar depois que a imagem nova voltar: mesma tela, escolher o modo
     de antes e conferir o interruptor "Responder automaticamente por este número".

## Se der errado

- Teste de baseline reprovando por causa de um bloco do fork: confira se ele aparece
  uma vez, igual ao `supabase/fork/9NNN.sql`, e no lugar certo (sem função: depois da
  VARREDURA anon, em ordem de número) — rode o script de novo.
- Colisão de número 9001 ou do timestamp `20261021130704`: o oficial nunca deve chegar
  na faixa 9000. Se chegar, renumere para outro número da faixa 9000 com outro
  timestamp e atualize migration, `supabase/fork/9001.sql`, baseline, testes e este
  documento juntos.

## Nomes das imagens deste fork

A conta xxfabioxx12 já publica `deskcommcrm`, `deskcomm-worker` e `deskcomm-scheduler` a partir de outro repositório (o Deskcomm FV, da barbearia). Para as imagens da NODZ nunca sobrescreverem aquelas, a automação `publish-image.yml` acrescenta ao nome o valor da variável de repositório `SUFIXO_DA_IMAGEM`. Neste fork ela vale `-nodz`, então as imagens saem como `ghcr.io/xxfabioxx12/deskcommcrm-nodz`, `deskcomm-worker-nodz`, `deskcomm-scheduler-nodz` e `deskcomm-voice-agent-nodz`. Sem a variável (como no projeto oficial) os nomes ficam iguais aos de sempre. Ao atualizar do oficial, se o `publish-image.yml` der conflito, mantenha o `${{ vars.SUFIXO_DA_IMAGEM }}` nas cinco linhas de nome de imagem.
