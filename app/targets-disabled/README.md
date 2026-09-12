# Cibles desactivees

`share/` : la Share Extension exige le groupe d'apps `group.io.claap.kovalink`, qui doit
etre cree dans le portail developpeur Apple (Identifiers > App Groups) puis assigne aux
trois bundle ids (`io.claap.kovalink`, `.notification-service`, `.share`). L'API publique
ne permet pas de le creer. Une fois fait par un Admin de l'equipe :
1. redeplacer `share/` dans `targets/`,
2. remettre `com.apple.security.application-groups` dans `app.json` et dans
   `targets/notification-service/expo-target.config.js` si la NSE en a besoin,
3. supprimer les profils dans `eas credentials` pour qu'ils soient regeneres,
4. relancer le build.
