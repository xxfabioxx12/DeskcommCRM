#!/usr/bin/env bash
# Reacrescenta no supabase/baseline.sql os blocos das migrations do fork (faixa
# 9000), guardados em supabase/fork/9NNN.sql, em ordem de número.
#
# Onde cada bloco entra:
#   - bloco SEM função: no fim do arquivo (o 9001, campanha com template);
#   - bloco COM função (`create function`): logo ANTES do bloco da VARREDURA
#     anon (migration 0116). Função criada depois da varredura nasce executável
#     pela anon key em quem ATUALIZA — ver
#     tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts.
#
# Uso, depois de trazer uma versão nova do oficial e resolver o conflito do
# baseline ficando com a versão deles:
#   bash scripts/fork/reaplicar-bloco-do-fork.sh          # na raiz do clone
#   bash scripts/fork/reaplicar-bloco-do-fork.sh <raiz>   # outra árvore (o teste usa)
#
# Bloco que já está no baseline (pela primeira linha, a marca) é pulado. Só do
# fork: não vai para PR no oficial.
set -euo pipefail

raiz="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
baseline="$raiz/supabase/baseline.sql"
pasta="$raiz/supabase/fork"
varredura="-- ---- VARREDURA anon:"

shopt -s nullglob
blocos=("$pasta"/9[0-9][0-9][0-9].sql)
shopt -u nullglob
if [[ ${#blocos[@]} -eq 0 ]]; then
  echo "Nenhum bloco em $pasta — sem a cópia dos blocos não há o que reaplicar." >&2
  exit 1
fi

for bloco in "${blocos[@]}"; do
  numero="$(basename "$bloco" .sql)"
  marca="$(head -n 1 "$bloco")"
  if grep -qF -- "$marca" "$baseline"; then
    echo "O bloco $numero já está no baseline. Nada a fazer."
    continue
  fi
  if grep -qiE '^[[:space:]]*create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function' "$bloco"; then
    if ! grep -qF -- "$varredura" "$baseline"; then
      echo "O baseline não tem o bloco da VARREDURA anon — não sei onde pôr o bloco $numero." >&2
      exit 1
    fi
    temporario="$(mktemp)"
    awk -v arquivo="$bloco" -v marca="$varredura" '
      !feito && index($0, marca) == 1 {
        while ((getline linha < arquivo) > 0) print linha
        close(arquivo)
        print ""
        feito = 1
      }
      { print }
    ' "$baseline" >"$temporario"
    mv "$temporario" "$baseline"
    echo "Bloco $numero (com função) inserido antes da VARREDURA anon em supabase/baseline.sql."
  else
    # Garante uma linha em branco entre o fim do oficial e o nosso bloco.
    if [[ -n "$(tail -c 1 "$baseline")" ]]; then
      printf '\n' >>"$baseline"
    fi
    printf '\n' >>"$baseline"
    cat "$bloco" >>"$baseline"
    echo "Bloco $numero acrescentado no fim de supabase/baseline.sql."
  fi
done
