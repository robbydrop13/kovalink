# 17. Dictee en direct (AssemblyAI)

Demande de Robin (30/10/2026) : brancher AssemblyAI sur la dictee de KovaLink, nourrie d'un
glossaire de son vocabulaire, et voir les mots s'ecrire pendant qu'il parle, puis se
consolider, comme le live transcript de l'app Claap.

## Architecture

- Le daemon (`daemon/src/voice/assemblyai.ts`) lit la cle dans le trousseau (service
  `assemblyai-api-key`), l'echange contre un jeton de 60 s et rend l'URL WebSocket complete.
- L'iPhone (`app/src/features/chat/voice.ts`) streame le PCM 16 kHz mono int16 de
  `AudioStream` directement a AssemblyAI. Aucun changement natif : `expo-audio` 57.0.5 est
  deja dans le build 1.1.0 (build 14), la livraison est une OTA.
- Etat pur et teste : `app/src/features/chat/liveTranscript.ts` (tours, mots acquis ou en
  suspens, texte final, devoilement mot a mot).
- Repli automatique sur Whisper (route absente, pas de cle, pas d'`AudioStream`).

## Choix du modele (mesures du 30/10, voix de synthese francaise, temps reel simule)

| Modele | Cadence des partiels | Qualite FR + termes anglais |
|---|---|---|
| `universal-3-6-pro` (retenu) | paquets toutes les 1,2 a 1,5 s | la meilleure, ponctuee |
| `universal-3-5-pro` `min_latency` | idem | proche, coupe plus souvent les tours |
| `universal-streaming-multilingual` | mot a mot, ~200 ms | mauvaise ("wawrkret", "tauria"), sans ponctuation |

Le mot a mot vient donc de l'app : les mots d'un paquet sont devoiles un par un (80 ms).
Le glossaire corrige l'essentiel : sans lui "Clara Agent", "EFL", "Lanlist", "The Spot" ;
avec lui "ClaapAgent", "AI fields", "lemlist", "HubSpot".

## Glossaire

`daemon/glossary/keyterms.txt`, 100 termes classes, relu a chaque dictee. Methode et mise a
jour : `daemon/README.md`.

## Ce qui reste

- Test reel par Robin sur l'iPhone (voix reelle, bruit, longues dictees).
- La montre (`kovalink-watch`) peut reutiliser la route de jeton en v2.
