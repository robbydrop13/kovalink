// Metro doit VOIR `packages/protocol` : `@kovalink/protocol` est un lien symbolique vers ce
// dossier (voir README, « Le protocole partagé »), et Metro ne sert que les fichiers de ses
// dossiers surveillés. Sans cette ligne, le bundle échoue sur un module introuvable dès que
// le lien remplace la copie.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const protocolDir = path.resolve(__dirname, '..', 'packages', 'protocol');
config.watchFolders = [...new Set([...(config.watchFolders ?? []), protocolDir])];

module.exports = config;
