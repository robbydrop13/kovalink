import { register } from 'node:module';

// Le dépouillement des types (`.ts` sans transpileur) n'existe qu'à partir de Node 22.6.
// En dessous, `node --test` échoue sur chaque fichier avec ERR_UNKNOWN_FILE_EXTENSION,
// ce qui ressemble à un bug du chargeur alors que c'est la version de Node. On le dit.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  process.stderr.write(
    `Les tests app exigent Node 22.6 ou plus (dépouillement des types), version courante ${process.versions.node}. ` +
      `Le daemon launchd tourne sous ~/.nvm/versions/node/v22.23.2 : \`nvm use 22\` puis relance.\n`,
  );
  process.exit(1);
}

register('./loader.mjs', import.meta.url);
