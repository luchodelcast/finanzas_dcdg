#!/bin/bash
# SessionStart hook — DCDG Finanzas
# Instala dependencias para que las pruebas (npm test) y el build (npm run build)
# funcionen en sesiones de Claude Code en la web.
set -euo pipefail

# Solo en el entorno remoto (Claude Code on the web); en local no hace falta.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (no ci): idempotente y aprovecha el cache del contenedor.
npm install --no-audit --no-fund
