#!/bin/bash
# Início de sessão na nuvem (Claude Code web/app): garante que o código local
# está igual ao GitHub antes de qualquer trabalho, e instala as dependências.
# A cópia do repositório pode vir de um retrato antigo do ambiente; sem isto o
# Claude lê código velho. Nunca descarta alteração local: só avança a branch
# quando dá para avançar sem conflito (fast-forward).
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# Tenta de novo em falha de rede (2s, 4s, 8s, 16s)
buscar() {
  local espera=2
  for _ in 1 2 3 4 5; do
    git fetch --prune origin "$@" >/dev/null 2>&1 && return 0
    sleep "$espera"
    espera=$((espera * 2))
  done
  return 1
}

if buscar dev main; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    buscar "$branch" || true
    if git rev-parse --verify --quiet "origin/$branch" >/dev/null; then
      if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
        if git merge --ff-only "origin/$branch" >/dev/null 2>&1; then
          echo "Código atualizado: $branch em $(git log -1 --format='%h %s')"
        else
          echo "AVISO: $branch tem commits locais que não estão no GitHub; não atualizei. Confira antes de trabalhar."
        fi
      else
        echo "AVISO: há alterações locais não salvas em $branch; não atualizei a partir do GitHub."
      fi
    fi
  fi
else
  echo "AVISO: não consegui buscar o GitHub; o código local pode estar desatualizado."
fi

# Dependências (npm install aproveita o cache do ambiente; postinstall roda prisma generate)
if [ -f package.json ]; then
  npm install --no-audit --no-fund >/dev/null 2>&1 || echo "AVISO: npm install falhou."
fi

exit 0
