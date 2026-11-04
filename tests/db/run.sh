#!/usr/bin/env bash
# Runs the real migration + RLS tests against a throwaway local PostgreSQL 16 (no Supabase account needed).
# Usage: tests/db/run.sh [socket_dir] [port]
set -euo pipefail
cd "$(dirname "$0")/../.."
H="${1:-/home/claude/.pgtest}"; P="${2:-54329}"
PSQL=(psql -h "$H" -p "$P" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "drop database if exists ih_test" -c "create database ih_test"
"${PSQL[@]}" -d ih_test -f tests/db/00_supabase_stub.sql
"${PSQL[@]}" -d ih_test -f supabase/migrations/20261102000001_infinity_hearts_schema.sql
"${PSQL[@]}" -d ih_test -tA -f tests/db/10_rls_tests.sql 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //' | grep -v '^$'
