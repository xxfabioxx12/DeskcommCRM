# NODZ: encaminhamento humano e painel

Correção do fork, no núcleo da instalação NODZ. A chamada `fn_nodz_garantir_caso_humano` serializa a abertura por conversa, preserva Casos anteriores e devolve um recibo. Os dois motores de encaminhamento a chamam antes de confirmar a passagem; falha no registro impede a confirmação. A passagem estruturada enriquece o Caso com o contexto. A ferramenta de Casos da IA continua usando a proteção de promessas já existente e deve permanecer habilitada na versão publicada.

No painel, Caso em `awaiting_human` prevalece sobre a última mensagem e sobre chat fechado. `awaiting_lead` não significa equipe pendente. Sem Caso, permanece o critério da conversa: cliente aguardando resposta, fila pendente ou conversa em andamento. A coluna conta conversas únicas, não quantidade de mensagens. Conversas com vários Casos aparecem uma vez. Os filtros de setor/número se aplicam também aos Casos. Todas as páginas são carregadas; erro de qualquer consulta é exibido.

Entrada: solicitação de atendimento humano. Saída: Caso + evento opened + passagem vinculada + coluna Aguardando. Responsável é determinado pelo número e pela configuração existente, sem reatribuição feita por esta mudança. Casos > responder/concluir fecha o ciclo; aguardar informação do cliente muda o estado do Caso. Falha de gravação aparece nos logs do encaminhamento e não autoriza o aviso. Não existe promessa de ausência absoluta de falhas de rede ou indisponibilidade.

Aplicação: migration 9222 antes das imagens novas. A versão anterior continua compatível com o schema aditivo. Bloco preservado em `supabase/fork/9222.sql` para próximas atualizações do oficial. Nenhum dado existente é apagado. Agentation existe somente na bancada local de revisão, fora das imagens.

Validação: `pnpm test:db tests/invariants/nodz-handoff-com-caso.test.ts tests/invariants/escalacao-ciclo-humano.test.ts`; testes de avisos dos dois motores; testes da classificação; typecheck; revisão visual do componente real com casos sintéticos (promessa, chat fechado e segunda página).
