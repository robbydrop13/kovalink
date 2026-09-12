# Lisibilite de l'onglet chat, retour de Robin apres usage reel

Retour brut : « je trouve peu lisible. Ce serait bien de copier un peu plus les interfaces
qui marchent comme Claude. On voit mal quand le modele travaille, les actions etc ».

C'est l'ecran central du produit (D1 : « l'agent a fini, je donne la suite »). Il doit
etre lisible d'un coup d'oeil, en marchant. On s'aligne sur les conventions de l'app
Claude, qui sont connues de Robin et qui marchent.

## Ce qui doit changer

1. **Etat de l'agent toujours visible.** Un bandeau fixe en haut de la session :
   `Travaille · 1 min 12 s` avec une animation discrete, `Attend ta reponse`,
   `Termine il y a 3 min`, `Hors ligne`. Aujourd'hui on ne sait pas si le modele travaille.
   Source : `working`, `awaiting`, `lastTurnEndAt` du pane, deja dans le store.

2. **Texte de l'assistant sans bulle.** Comme Claude : texte pleine largeur, aligne a
   gauche, sans cadre. Seul le message de l'utilisateur est dans une bulle, discrete,
   alignee a droite. Les bulles partout rendent tout illisible.

3. **Les actions comme lignes compactes, pas comme blocs.** Chaque appel d'outil est une
   ligne d'une hauteur fixe : icone, verbe, cible, etat.
   `Lit  app/src/boot.ts`, `Execute  npm test`, `Modifie  pair.tsx  +12 -3`,
   `Cherche  "promptHash"`. Etat a droite : en cours (animation), termine (coche),
   echec (croix rouge). Un tap deplie le resultat, replie par defaut. Les appels
   consecutifs sont groupes (« 5 actions », depliable). C'est exactement ce que Claude
   fait, et c'est ce qui rend une longue session lisible.

4. **Le texte arrive au fil de l'eau.** Le daemon lit le JSONL ligne par ligne : un tour
   assistant en cours doit s'afficher progressivement, pas d'un bloc a la fin. Un curseur
   ou un point pulse en fin de texte tant que le tour n'est pas clos.

5. **Hierarchie typographique.** Le texte courant en taille lisible (17 pt), les lignes
   d'action en 14 pt secondaire, les resultats d'outils en monospace 13 pt. Aujourd'hui
   tout est au meme niveau.

6. **Le dernier echange d'abord.** A l'ouverture, la vue est calee sur le dernier message
   de l'utilisateur et ce qui a suivi, l'historique au dessus se charge en tirant.

## Ce qui ne change pas
La barre de validation (4.3 du design), le composer a trois regimes, la securite.

## Retour 2, apres usage : « tu replies trop vite l'historique »

Le point 6 (dernier echange d'abord) a ete applique trop agressivement. Correction :

7. **Garder les trois derniers echanges deplies**, pas seulement le dernier. Un echange
   = un message utilisateur et tout ce qui suit jusqu'au suivant. L'historique au dela
   se charge en tirant vers le haut.
8. **Un nouvel envoi ne replie jamais l'echange precedent.** Robin doit pouvoir relire
   ce que l'agent vient de faire pendant que le tour suivant demarre.
9. **Les groupes d'actions ne se replient qu'au dela de 5 actions**, et ce que Robin a
   deplie a la main reste deplie tant que la session est ouverte (etat memorise par
   identifiant de tour, pas par position).
10. **Aucun repli automatique dans le temps.** Rien ne se referme tout seul apres N
    secondes ou a l'arrivee d'un evenement.
