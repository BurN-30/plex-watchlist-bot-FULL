// utils/plexChecker.js
import fetch from 'node-fetch';

// CACHE GLOBAL POUR LA SESSION DE SCAN
// Key: "sectionID_year" (ex: "1_2024")
// Value: Array of items metadata
const scanCache = new Map();

export function clearScanCache() {
  scanCache.clear();
  // console.log('🧹 Cache de scan vidé.');
}

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function getLibrarySections(config) {
  const url = `${config.plexUrl}/library/sections?X-Plex-Token=${config.plexToken}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json();
    const allSections = json.MediaContainer?.Directory || [];
    
    // Filtrer pour ne garder que les bibliothèques de films et séries
    return allSections
      .filter(s => ['movie', 'show'].includes(s.type))
      .map(s => String(s.key));
  } catch (e) {
    console.warn('⚠️ Impossible de récupérer les sections de la bibliothèque Plex.');
    return [];
  }
}

/**
 * Vérifie via Tautulli si disponible
 * Utilise get_library_media_info pour chercher par ID (plus fiable/rapide)
 */
async function checkViaTautulli(config, title, year, provider, id, sectionIDs) {
  if (!config.tautulliUrl || !config.tautulliApiKey) return null;
  
  const baseUrl = config.tautulliUrl;
  const apiKey = config.tautulliApiKey;
  
  // Si pas de sectionIDs, on tente sans (certaines commandes le permettent ou défaut)
  const sections = (sectionIDs && sectionIDs.length > 0) ? sectionIDs : [null];

  for (const sectionId of sections) {
    try {
      // Essai 1: Recherche par ID via get_library_media_info
      if (id) {
        let url = `${baseUrl}/api/v2?apikey=${apiKey}&cmd=get_library_media_info&search=${id}`;
        if (sectionId) url += `&section_id=${sectionId}`;

        const res = await fetch(url);
        const json = await res.json();
        
        // Structure typique Tautulli pour les DataTables : response.data.data[]
        const items = json.response?.data?.data || [];
        
        if (items.length > 0) {
          const item = items[0];
          console.log(`🎯 [Tautulli] ID Match! (Section ${sectionId}) "${title}" -> "${item.title}"`);
          return { found: true, plexTitle: item.title };
        }
      }
    } catch (e) {
      console.warn(`⚠️ Erreur Tautulli check (Section ${sectionId}):`, e.message);
    }
  }
  return null;
}

/**
 * Retourne un objet : { found: boolean, plexTitle: string | null }
 */
export async function checkIfInPlex(title, year, type, config, provider = null, id = null) {
  const token = config.plexToken;
  const plexBase = config.plexUrl || 'http://localhost:32400'; 
  const headers = { 'Accept': 'application/json' };

  // Conversion du type (RSS) vers type Plex (API)
  const plexType = (type === 'show') ? '2' : '1';

  // Récupérer les IDs des bibliothèques pertinentes (films/séries)
  const sectionIDs = await getLibrarySections(config);

  // --- M0: Tautulli Check (Prioritaire) ---
  // Si Tautulli est configuré, on l'utilise en premier pour vérifier l'ID
  const tautulliRes = await checkViaTautulli(config, title, year, provider, id, sectionIDs);
  if (tautulliRes) return tautulliRes;

  // --- M1: Recherche par Titre + Filtrage strict ---
  try {
    // On ajoute &type=${plexType} pour ne chercher que des films OU des séries
    // Augmentation de la limite à 50 résultats
    const searchUrl = `${plexBase}/search?query=${encodeURIComponent(title)}&type=${plexType}&includeGuids=1&X-Plex-Container-Size=50&X-Plex-Token=${token}`;
    const res = await fetch(searchUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    const results = json.MediaContainer?.Metadata || [];

    for (const item of results) {
      // On s'assure que le résultat vient d'une section Film/Série
      if (sectionIDs.length > 0 && !sectionIDs.includes(String(item.librarySectionID))) {
        continue;
      }

      // 1. Vérification par ID (Le plus fiable)
      if (provider && id) {
        // Plex retourne souvent les IDs externes dans un tableau "Guid" (ex: [{id: 'imdb://tt123'}, ...])
        const externalGuids = item.Guid || [];
        
        // 🔒 MATCH STRICT : On construit le GUID exact attendu (ex: tvdb://379169)
        // Cela évite les faux positifs sur les IDs numériques (ex: ID 123 qui matcherait dans 12345)
        const targetGuid = `${provider}://${id}`;
        
        let match = externalGuids.some(g => g.id === targetGuid);

        // Fallback spécifique pour IMDb (IDs en 'tt...') :
        // Comme les IDs IMDb sont uniques globalement, on peut être un peu plus souple si le provider diffère légèrement
        // mais on garde une vérification stricte de la fin de chaîne pour éviter les match partiels (tt1 vs tt12)
        if (!match && id.startsWith('tt')) {
           match = externalGuids.some(g => g.id && g.id.endsWith(`://${id}`));
           
           // Support des agents Legacy (com.plexapp.agents.imdb://tt...)
           if (!match && item.guid) {
             match = item.guid.includes(`://${id}`) || item.guid.endsWith(id);
           }
        }

        if (match) {
           console.log(`🎯 [M1] Titre "${title}" trouvé via ID Strict (${targetGuid}) -> "${item.title}"`);
           return { found: true, plexTitle: item.title };
        }

        // 🔒 SÉCURITÉ ANTI-FAUX POSITIFS :
        // Si un ID est fourni dans le RSS, on EXIGE que Plex ait cet ID.
        // On refuse le fallback sur le titre/année pour éviter de valider un homonyme (ex: Ballerina 2023 vs 2025).
        continue;
      }

      // 2. Vérification par Titre + Année (Fallback - Uniquement si pas d'ID source)
      const itemYear = parseInt(item.year);
      const targetYear = parseInt(year);
      // Tolérance de +/- 1 an
      const yearMatch = !year || !itemYear || (Math.abs(itemYear - targetYear) <= 1);
      
      const cleanTitle = normalize(title);
      const cleanPlexTitle = normalize(item.title);
      const cleanOriginal = normalize(item.originalTitle);

      if (yearMatch && (cleanTitle === cleanPlexTitle || cleanTitle === cleanOriginal)) {
        console.log(`🎯 [M1] Titre Match -> "${item.title}" (Année: ${item.year})`);
        return { found: true, plexTitle: item.title };
      }
    }
  } catch (e) { 
    console.error(`❌ Erreur check Plex (M1) pour "${title}":`, e.message); 
  }

  // --- M2: Scan Structuré par Année (Méthode Ultime) ---
  // Au lieu d'une recherche globale, on itère sur chaque section avec un filtre strict sur l'année.
  // On gère la pagination pour être sûr de ne rien louper.
  // MODIFICATION : On scanne l'année cible +/- 1 an pour gérer les décalages de métadonnées.
  if (id && year) {
    try {
      // On définit la plage d'années à scanner (ex: 2012 -> [2011, 2012, 2013])
      const yearsToScan = [year, year - 1, year + 1];
      // On déduplique au cas où et on filtre les années invalides
      const uniqueYears = [...new Set(yearsToScan)].filter(y => y > 1900 && y < 2100);

      for (const sectionID of sectionIDs) {
        for (const scanYear of uniqueYears) {
          const cacheKey = `${sectionID}_${scanYear}`;
          let items = [];

          // ⚡ OPTIMISATION CACHE : Si on a déjà scanné cette année pour cette section, on utilise le cache
          if (scanCache.has(cacheKey)) {
            items = scanCache.get(cacheKey);
            // console.log(`⚡ Cache Hit: Année ${scanYear} (Section ${sectionID}) - ${items.length} items`);
          } else {
            // Sinon, on fait le scan complet (API)
            let start = 0;
            const size = 100; 
            let hasMore = true;
            
            while (hasMore) {
              const url = `${plexBase}/library/sections/${sectionID}/all?type=${plexType}&year=${scanYear}&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}&X-Plex-Token=${token}`;
              const res = await fetch(url, { headers });
              if (!res.ok) break;

              const json = await res.json();
              const pageItems = json.MediaContainer?.Metadata || [];
              items.push(...pageItems);

              if (pageItems.length < size) hasMore = false;
              else start += size;
            }
            // On sauvegarde le résultat complet dans le cache
            scanCache.set(cacheKey, items);
            // console.log(`📥 Mise en cache: Année ${scanYear} (Section ${sectionID}) - ${items.length} items`);
          }

          // Recherche locale dans les items (qu'ils viennent du cache ou du fetch)
          for (const item of items) {
            const externalGuids = item.Guid || [];
            const matchId = externalGuids.some(g => g.id && g.id.includes(id));
            const matchInternal = item.guid && item.guid.includes(id);

            if (matchId || matchInternal) {
               console.log(`🎯 [M2-Ultime] Scan Année ${scanYear} (Cible: ${year}) (Section ${sectionID}) -> Trouvé : "${item.title}"`);
               return { found: true, plexTitle: item.title };
            }
          }
        }
      }
    } catch (e) {
      console.error(`❌ Erreur check Plex (M2-Ultime) pour "${title}":`, e.message);
    }
  }

  return { found: false, plexTitle: null };
}