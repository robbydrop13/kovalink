/**
 * Type MIME devine par extension. Contrat partage : le daemon l'applique au listing du
 * bloc C, l'app aux pieces jointes du chat (docs/15) pour choisir une vignette ou un
 * apercu AVANT que le Mac ait vu le fichier. Une seule table, des deux cotes.
 *
 * Il sert a CHOISIR UN APERCU, jamais a autoriser quoi que ce soit : une decision de
 * securite ne se prend pas sur une extension. La table couvre ce que le PRD C2 exige
 * (images, PDF, texte, code, markdown) plus les archives, pour lesquelles l'app affiche
 * les metadonnees.
 */
const BY_EXT: Record<string, string> = {
  // Images (PRD C2 : HEIC, PNG, JPG, GIF, WebP)
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/vnd.microsoft.icon',
  '.avif': 'image/avif',
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.key': 'application/vnd.apple.keynote',
  '.pages': 'application/vnd.apple.pages',
  '.numbers': 'application/vnd.apple.numbers',
  // Texte et code
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.ini': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.swift': 'text/x-swift',
  '.java': 'text/x-java',
  '.kt': 'text/x-kotlin',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.hpp': 'text/x-c++',
  '.m': 'text/x-objectivec',
  '.sh': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.env': 'text/plain',
  '.log': 'text/plain',
  '.plist': 'application/xml',
  '.lock': 'text/plain',
  '.gitignore': 'text/plain',
  // Media
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  // Archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.tgz': 'application/gzip',
  '.dmg': 'application/x-apple-diskimage',
  '.7z': 'application/x-7z-compressed',
};

function mimeForExt(ext: string): string | null {
  return BY_EXT[ext.toLowerCase()] ?? null;
}

/**
 * Fichiers sans extension qui sont pourtant du texte. La liste est courte et explicite :
 * deviner par heuristique sur le contenu couterait une lecture a chaque ligne du listing.
 */
const TEXT_BASENAMES = new Set([
  'Makefile',
  'Dockerfile',
  'LICENSE',
  'README',
  'CHANGELOG',
  'Brewfile',
  'Procfile',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.prettierrc',
  '.eslintrc',
]);

export function mimeForName(name: string, ext: string): string | null {
  const byExt = mimeForExt(ext);
  if (byExt) return byExt;
  return TEXT_BASENAMES.has(name) ? 'text/plain' : null;
}
