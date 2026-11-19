#!/usr/bin/env bash
# Publica el sitio y el panel en Cloudflare Pages desde una carpeta limpia.
#   bash herramientas/publicar.sh
# Solo se sube lo que está en git (commit). El código del panel (functions/) va aparte
# de los archivos públicos, así que no queda descargable.
set -euo pipefail
cd "$(dirname "$0")/.."
D="$(mktemp -d)"
mkdir -p "$D/public"
git ls-files -z \
  | grep -zvE '(\.py$|\.mjs$|\.sh$|^README\.md$|^\.nojekyll$|^\.gitignore$|^wrangler\.toml$|^functions/|^migrations/|^herramientas/)' \
  | tar --null -T - -cf - | tar -xf - -C "$D/public"
git ls-files -z functions | tar --null -T - -cf - | tar -xf - -C "$D"
sed 's/^pages_build_output_dir = .*/pages_build_output_dir = "public"/' wrangler.toml > "$D/wrangler.toml"
echo "Archivos públicos: $(find "$D/public" -type f | wc -l)"
cd "$D"
npx wrangler pages deploy --project-name red-pcc-ohiggins --branch main --commit-dirty=true
