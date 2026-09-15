// Recherche des palettes : sans accents ni casse, tous les mots requis. Pur, testé.

/** « run » trouve « RunCoach », « lien » ne trouve rien. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Tous les mots de la requête doivent apparaître dans la meule. Requête vide : tout passe. */
export function matchesQuery(hay: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return true;
  const folded = fold(hay);
  return words.every((w) => folded.includes(w));
}
