#!/bin/bash
# Les icônes sont des icônes Feather (`src/ui/Icon.tsx`), jamais des glyphes textuels.
# Le script retire les commentaires des fichiers d'interface et cherche les glyphes de
# l'inventaire du 12 septembre utilisés comme icônes : rendus seuls dans un `<Txt>`, ou
# comme chaîne d'un seul de ces caractères. Les puces de liste Markdown (`•`, `◦`) et les
# pastilles de couleur (des `View`) ne sont pas concernées. Seul `src/ui/Icon.tsx` importe Feather.
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=en_US.UTF-8

FILES=$(find app src -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path 'src/i18n/*' -not -name '*.d.ts')
GLYPHS='(✓|✔|✖|✕|×|●|○|▍|▫|▢|▤|⊘|⚠|↑|↓|←|→|★|☆|‹|›|···)'

status=0
for f in $FILES; do
  stripped=$(perl -0pe 's#/\*.*?\*/##gs; s#(^|[^:])//[^\n]*#$1#gm' "$f")
  # Glyphe seul sur sa ligne (enfant d'un <Txt>), ou chaîne d'un seul glyphe ou d'une lettre-icône.
  hits=$(printf '%s' "$stripped" | grep -nE "^\s*$GLYPHS\s*$|['\"\`]$GLYPHS['\"\`]|['\"\`](v|o|>|<|\+|!|\.\.\.)['\"\`]\s*(:|\?|;|,|\))" || true)
  if [ -n "$hits" ]; then
    echo "$f"
    echo "$hits" | sed 's/^/  /'
    status=1
  fi
done
feather=$(grep -rl "@expo/vector-icons" app src | grep -v '^src/ui/Icon.tsx$' || true)
if [ -n "$feather" ]; then
  echo "Feather importé hors de src/ui/Icon.tsx :"
  echo "$feather" | sed 's/^/  /'
  status=1
fi
if [ $status -ne 0 ]; then
  echo "check-icons: des glyphes textuels subsistent dans l'interface (voir ci dessus)." >&2
fi
exit $status
