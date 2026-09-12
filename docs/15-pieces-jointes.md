# Pieces jointes dans le chat, demande de Robin

« Je veux pouvoir ajouter des pieces jointes ou photos a mes chats. »

## Principe
Claude Code lit un fichier dont le chemin figure dans le prompt (une image est affichee
a Claude, un PDF ou un texte est lu). Kova fait deja cela pour un collage d'image dans
le terminal : il ecrit `/tmp/kova-paste-<ts>.png` et injecte le chemin. On reproduit
exactement ce mecanisme depuis l'iPhone.

## Comportement
1. **Bouton « + » dans le composer** : Photos, Appareil photo, Fichiers. Selection
   multiple. Vignettes au dessus du champ de saisie, retirables d'un tap, avant envoi.
2. **Envoi** : chaque piece est televersee vers le Mac par l'upload en flux existant
   (reprise, empreinte), dans `/tmp/kovalink/attachments/<sessionId>/<horodatage>-<nom>`.
   Ce chemin est hors de `$HOME`, donc hors de la regle des fichiers caches, et il est
   nettoye au redemarrage du Mac, ce qui est le comportement voulu pour une piece jointe
   de conversation. Le daemon cree le dossier avec les droits de Robin uniquement.
3. **Le message envoye** est le texte de Robin suivi, sur des lignes separees, d'une
   ligne par piece : le chemin absolu, tel que Kova le fait pour un collage. Aucun
   texte inventé, aucun prefixe : Claude Code reconnait le chemin.
   Exemple :
   ```
   voici la maquette, adapte la barre du haut
   /tmp/kovalink/attachments/2b1f5c3e/20260911-153012-IMG_4231.jpg
   ```
4. **Ordre** : televersement d'abord, et le texte ne part QUE si toutes les pieces sont
   arrivees (empreinte verifiee). Sinon, erreur explicite avec la cause, rien n'est envoye,
   les vignettes restent pour reessayer. Le message reste en file hors ligne comme un
   texte, avec ses pieces.
5. **Affichage dans le chat** : le message utilisateur montre les vignettes (image) ou
   une ligne nom + taille (autre), le chemin est masque. Un tap ouvre l'apercu existant
   du bloc Fichiers.
6. **Limites** : avertissement au dela de 100 Mo en cellulaire (regle A4, deja en place),
   photos envoyees en taille originale (Claude a besoin des details, et le Mac est le
   destinataire, pas un serveur).
7. **Securite** : tout passe par `KeyGate` pour le texte et par `resolveForWrite` pour
   les fichiers, comme le reste. Le dossier des pieces jointes est en lecture normale
   pour le navigateur de fichiers. Rien de nouveau n'est ouvert.

## Hors perimetre
Pieces jointes venant du Mac vers l'iPhone dans le chat (les fichiers modifies par Claude
se consultent deja via le bloc Fichiers). Compression ou redimensionnement.
