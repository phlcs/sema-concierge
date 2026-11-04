#!/usr/bin/env bash
# Sobe/derruba um PostgreSQL 16 DESCARTÁVEL para os testes da estrutura de dados (T02).
# Só escuta em socket Unix (sem TCP), num diretório temporário. Nunca toca em banco real.
#
#   recuperacao/testes/banco-teste.sh start   → imprime a TESTE_DATABASE_URL
#   recuperacao/testes/banco-teste.sh stop
#
# Requer os binários do PostgreSQL 16 e o usuário "postgres" (o servidor recusa root).
# Alternativa sem este script: `docker compose up -d postgres` e aponte
# TESTE_DATABASE_URL para ele (o teste cria e apaga o próprio banco "t02_*").
set -euo pipefail

BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
BASE="${TESTE_PG_DIR:-/tmp/t02-pg}"
DATA="$BASE/data"
SOCK="$BASE/sock"
USR=postgres

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u "$USR" -- "$@"; else "$@"; fi; }

case "${1:-}" in
  start)
    mkdir -p "$SOCK"; chown -R "$USR" "$BASE" 2>/dev/null || true
    if [ ! -d "$DATA" ]; then
      as_pg "$BIN/initdb" -D "$DATA" -U "$USR" --auth=trust >/dev/null
    fi
    as_pg "$BIN/pg_ctl" -D "$DATA" -l "$BASE/pg.log" -w \
      -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c fsync=off -c max_connections=60" start >/dev/null
    echo "postgresql://$USR@localhost/postgres?host=$SOCK"
    ;;
  stop)
    as_pg "$BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
    ;;
  *) echo "uso: $0 start|stop" >&2; exit 2 ;;
esac
