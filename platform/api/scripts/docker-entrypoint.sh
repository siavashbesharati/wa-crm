#!/bin/sh
# Container entrypoint: run pending migrations then exec the given CMD.
# We keep this tiny and POSIX-sh so it works on the slim Debian image
# without bash or coreutils-extra.

set -eu

log() { printf "[entrypoint] %s\n" "$*"; }

wait_for_db() {
    # Extract host:port from $DATABASE_URL (postgresql+psycopg://user:pass@host:port/db)
    url="${DATABASE_URL:-}"
    case "$url" in
        postgresql+psycopg://*|postgresql://*|postgres://*)
            host=$(printf '%s' "$url" | sed -E 's#^[a-z+]+://[^@]+@##; s#/.*$##; s#:# #')
            host_name=$(printf '%s' "$host" | awk '{print $1}')
            host_port=$(printf '%s' "$host" | awk '{print $2}')
            host_port=${host_port:-5432}
            ;;
        sqlite*)
            log "SQLite database detected - skipping wait_for_db"
            return 0
            ;;
        *)
            log "Unknown DATABASE_URL scheme: $url - skipping wait_for_db"
            return 0
            ;;
    esac

    log "Waiting for Postgres at $host_name:$host_port ..."
    i=0
    while ! python -c "
import socket, sys
s = socket.socket()
s.settimeout(2)
try:
    s.connect(('$host_name', $host_port))
    s.close()
    sys.exit(0)
except Exception as e:
    sys.exit(1)
" >/dev/null 2>&1; do
        i=$((i + 1))
        if [ "$i" -ge 60 ]; then
            log "Postgres not reachable after 60s - giving up"
            exit 1
        fi
        sleep 1
    done
    log "Postgres is up"
}

run_migrations() {
    if [ -n "${SKIP_MIGRATIONS:-}" ]; then
        log "SKIP_MIGRATIONS set - skipping migrations"
        return 0
    fi
    # First-time schema setup. The app's Base.metadata.create_all() handles
    # the multichannel core tables; the per-connector migration scripts add
    # the connector-specific tables.
    log "Running multichannel bootstrap"
    python scripts/migrate_multichannel.py || log "  (multichannel bootstrap failed, continuing)"
    log "Running connector migrations (baileys, divar, bale)"
    python scripts/migrate_baileys.py  || log "  (baileys migration failed, continuing)"
    python scripts/migrate_divar.py   || log "  (divar migration failed, continuing)"
    python scripts/migrate_bale.py    || log "  (bale migration failed, continuing)"
}

wait_for_db
run_migrations

log "Starting: $*"
exec "$@"
