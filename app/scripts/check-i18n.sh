#!/bin/bash
# L'interface est en anglais : aucun mot français ni caractère accentué dans les chaînes
# visibles. Le script retire les commentaires (`//`, `/* */`) des fichiers `.ts` et `.tsx`
# de `app/` et `src/` (hors `src/i18n/`, hors tests), puis cherche les accents et une
# liste de mots français courants. Une seule occurrence fait échouer `npm test`.
set -euo pipefail
cd "$(dirname "$0")/.."
# Les classes de caractères accentués exigent une locale UTF-8, sinon grep compare des octets.
export LC_ALL=en_US.UTF-8

FILES=$(find app src -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path 'src/i18n/*' -not -name '*.d.ts')
WORDS='\b(Interrompre|Travaille|Attend|Terminé|Réglages|Fichiers|Nouvelle|Reprendre|Fermer|Renommer|Ouvrir|Envoyer|Annuler|Réessayer|Aucun|Aucune|injoignable|Hors ligne|en attente|en cours|Réponds|Lecture|Chargement|Rafraîchir|Partager|Lancer|fermée|récents|Onglet|Dossier|Non confirmé|sur le Mac|Suivre|Brouillon|Favori|Refusé|impossible|Créer|Envoi|Appareil|Appairage|Révoquer|Quitter|Valider|inconnu|indisponible|Ouvert|Copié|Téléverser|Télécharger|Parcourir|Choisir|Renvoyer)\b'

status=0
for f in $FILES; do
  # Retire les blocs `/* ... */` puis les fins de ligne `// ...` (hors URL `://`).
  stripped=$(perl -0pe 's#/\*.*?\*/##gs; s#(^|[^:])//[^\n]*#$1#gm' "$f")
  hits=$(printf '%s' "$stripped" | grep -niE "[àâäéèêëîïôöùûüçœ]|$WORDS" || true)
  if [ -n "$hits" ]; then
    echo "$f"
    echo "$hits" | sed 's/^/  /'
    status=1
  fi
done
if [ $status -ne 0 ]; then
  echo "check-i18n: du français subsiste dans l'interface (voir ci dessus)." >&2
fi
exit $status
