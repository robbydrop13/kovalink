# Variables d'environnement pour EAS (build, submit, update). A SOURCER, pas a executer :
#
#   source app/scripts/eas-env.sh
#
# Les secrets ne sont pas dans le depot. Ils vivent dans ~/.kovalink (ou $KOVALINK_HOME) :
#   asc-api.json  {"keyId": "...", "issuerId": "...", "keyPath": "/chemin/vers/la-cle-asc.p8"}
#                 cle API App Store Connect, lue par `eas submit` via EXPO_ASC_*
#   expo-token    jeton d'acces Expo (une ligne), lu par eas-cli via EXPO_TOKEN
#
# L'identifiant d'equipe Apple est lu dans eas.json (submit.production.ios.appleTeamId) :
# ce n'est pas un secret, il reste versionne.

_kl_home="${KOVALINK_HOME:-$HOME/.kovalink}"
_kl_asc="$_kl_home/asc-api.json"
_kl_token="$_kl_home/expo-token"

# Dossier du script, que l'on soit sous zsh ou bash.
if [ -n "${ZSH_VERSION:-}" ]; then
  _kl_dir="$(cd "$(dirname "${(%):-%x}")" && pwd)"
else
  _kl_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
_kl_eas_json="$_kl_dir/../eas.json"

if [ ! -r "$_kl_asc" ]; then
  echo "eas-env: $_kl_asc introuvable ou illisible." >&2
  return 1 2>/dev/null || exit 1
fi

# node est present partout ou le projet se construit ; il lit les deux JSON et n'emet que
# des `export` avec des valeurs entre apostrophes, donc sans expansion du shell.
_kl_exports="$(node -e '
  const fs = require("fs");
  const sq = String.fromCharCode(39);
  const quote = (v) => sq + String(v).split(sq).join(sq + "\\" + sq + sq) + sq;
  const asc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const eas = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const vars = {
    EXPO_ASC_KEY_ID: asc.keyId,
    EXPO_ASC_ISSUER_ID: asc.issuerId,
    EXPO_ASC_API_KEY_PATH: asc.keyPath,
    EXPO_APPLE_TEAM_ID: eas.submit?.production?.ios?.appleTeamId,
    EXPO_APPLE_TEAM_TYPE: "COMPANY_OR_ORGANIZATION",
  };
  for (const [k, v] of Object.entries(vars)) {
    if (!v) { console.error("eas-env: valeur manquante pour " + k); process.exit(1); }
    console.log("export " + k + "=" + quote(v));
  }
' "$_kl_asc" "$_kl_eas_json")" || {
  unset _kl_home _kl_asc _kl_token _kl_dir _kl_eas_json _kl_exports
  return 1 2>/dev/null || exit 1
}
eval "$_kl_exports"

if [ -r "$_kl_token" ]; then
  export EXPO_TOKEN="$(tr -d '\r\n' < "$_kl_token")"
else
  echo "eas-env: $_kl_token absent, EXPO_TOKEN non exporte (connexion par \`eas login\`)." >&2
fi

unset _kl_home _kl_asc _kl_token _kl_dir _kl_eas_json _kl_exports
