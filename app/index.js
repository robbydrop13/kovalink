// Point d'entrée.
//
// La tâche de réponse aux notifications est enregistrée AVANT tout rendu React : iOS peut
// relancer un processus mort pour livrer une action rapide et n'accorde que quelques
// secondes.
//
// Elle est enveloppée dans un try/catch parce qu'une exception à ce niveau se produit avant
// que React n'existe : il n'y a donc aucune frontière d'erreur pour la rattraper, et le
// symptôme serait un écran blanc muet. Le module est lui même protégé, ceci est la ceinture
// par dessus les bretelles.
try {
  require('./src/notifications/backgroundTask');
} catch (error) {
  console.warn('[KovaLink boot] tâche de fond indisponible', error && error.message);
}

require('expo-router/entry');
