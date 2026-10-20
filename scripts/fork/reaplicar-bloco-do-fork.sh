#!/usr/bin/env bash
# Reacrescenta no fim do supabase/baseline.sql o bloco da migration 9001 do fork
# (campanha com template aprovado), guardado em supabase/fork/9001.sql.
#
# Uso, depois de trazer uma versão nova do oficial e resolver o conflito do
# baseline ficando com a versão deles:
#   bash scripts/fork/reaplicar-bloco-do-fork.sh
#
# Não faz nada se o bloco já estiver lá. Só do fork: não vai para PR no oficial.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/../.." && pwd)"
baseline="$raiz/supabase/baseline.sql"
bloco="$raiz/supabase/fork/9001.sql"
marca="-- ---- campanha com template aprovado (migration 9001"

if [[ ! -f "$bloco" ]]; then
  echo "Falta $bloco — sem a cópia do bloco não há o que reaplicar." >&2
  exit 1
fi

if grep -qF -- "$marca" "$baseline"; then
  echo "O bloco 9001 já está no baseline. Nada a fazer."
  exit 0
fi

# Garante uma linha em branco entre o fim do oficial e o nosso bloco.
if [[ -n "$(tail -c 1 "$baseline")" ]]; then
  printf '\n' >>"$baseline"
fi
printf '\n' >>"$baseline"
cat "$bloco" >>"$baseline"
echo "Bloco 9001 acrescentado no fim de supabase/baseline.sql."
