// utils/plexChecker.js
import fetch from 'node-fetch';

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Retourne un objet : { found: boolean, plexTitle: string | null }
 */
export async function checkIfInPlex(title, year, config, provider = null, id = null) {
  const token = config.plexToken;
  const plexBase = 'http://localhost:32400'; 
  const headers = { 'Accept': 'application/json' };

  // --- M1: Recherche par ID (Le Code-Barres) ---
  if (id) {
    try {
      const res = await fetch(`${plexBase}/search?query=${id}&X-Plex-Token=${token}`, { headers });
      const json = await res.json();
      const items = json.MediaContainer?.Metadata || [];
      
      if (items.length > 0) {
        // ON RÉCUPÈRE LE TITRE EXACT DANS PLEX (FRANÇAIS)
        const foundTitle = items[0].title;
        console.log(`🎯 [M1] ID Match! "${title}" (Letterboxd) est "${foundTitle}" (Plex)`);
        return { found: true, plexTitle: foundTitle };
      }
    } catch (e) {}
  }

  // --- M2: Recherche GUID (Fallback) ---
  if (provider && id) {
    try {
      const res = await fetch(`${plexBase}/library/metadata?guid=${encodeURIComponent(`${provider}://${id}`)}&X-Plex-Token=${token}`, { headers });
      const json = await res.json();
      const items = json.MediaContainer?.Metadata || [];
      if (items.length > 0) {
         const foundTitle = items[0].title;
         console.log(`🎯 [M2] Metadata Match! Trouvé : "${foundTitle}"`);
         return { found: true, plexTitle: foundTitle };
      }
    } catch (e) {}
  }

  // --- M3: Recherche Titre (Fallback) ---
  try {
    const res = await fetch(`${plexBase}/search?query=${encodeURIComponent(title)}&includeGuids=1&X-Plex-Token=${token}`, { headers });
    const json = await res.json();
    const results = json.MediaContainer?.Metadata || [];

    for (const item of results) {
      // Vérif ID secondaire
      if (provider && id) {
        if ((item.guid && item.guid.includes(id)) || (item.Guid && item.Guid.some(g => g.id.includes(id)))) {
           console.log(`🎯 [M3] Titre Match avec ID valide -> "${item.title}"`);
           return { found: true, plexTitle: item.title };
        }
      }
      // Vérif Titre+Année
      const itemYear = parseInt(item.year);
      const targetYear = parseInt(year);
      const yearMatch = !year || (Math.abs(itemYear - targetYear) <= 1);
      const cleanTitle = normalize(title);
      const cleanPlexTitle = normalize(item.title);
      const cleanOriginal = normalize(item.originalTitle);

      if (yearMatch && (cleanTitle === cleanPlexTitle || cleanTitle === cleanOriginal)) {
        console.log(`🎯 [M3] Titre Match -> "${item.title}"`);
        return { found: true, plexTitle: item.title };
      }
    }
  } catch (e) { console.error(e.message); }

  return { found: false, plexTitle: null };
}