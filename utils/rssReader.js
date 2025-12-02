// utils/rssReader.js
import Parser from 'rss-parser';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const parser = new Parser();

/**
 * Charge un flux RSS (HTTP(S) ou local file://) et renvoie un tableau
 * [{ title, year, provider, id, type }] exploitable par checkIfInPlex().
 *
 * @param {string} rssUrl — URL http/https ou file://C:/…
 * @returns {Promise<Array<object>>}
 */
export async function fetchWatchlist(rssUrl) {
  let feed = { items: [] };

  /* ---------- 1) Chargement du flux ---------- */
  try {
    if (rssUrl.startsWith('file://')) {
      // Transforme proprement l’URI file:// en chemin local
      const path = fileURLToPath(rssUrl);           // ex. C:/PlexTools/feeds/sacmiam.xml
      const xml  = await fs.readFile(path, 'utf8');
      feed       = await parser.parseString(xml);
    } else {
      feed = await parser.parseURL(rssUrl);
    }
  } catch (err) {
    console.warn(`⚠️  Impossible de lire ${rssUrl} : ${err.code || err.message}`);
    return [];            // fail-soft : on ignore ce flux
  }

  /* ---------- 2) Parsing de chaque item ---------- */
  return feed.items.map(item => {
    /* -------- titre + année -------- */
    const mTitle = item.title?.match(/^(.*?)\s*\((\d{4})\)$/);
    const title  = mTitle ? mTitle[1].trim()
                          : (item.title ?? '').trim();
    const year   = mTitle && !isNaN(mTitle[2]) ? Number(mTitle[2]) : null;

    /* -------- provider + id -------- */
    let provider = null;
    let id       = null;

    if (item.guid) {
      const guid = item.guid;

      /* 1) Format "imdb://tt123" ou "tmdb://456" ------------------- */
      let m = guid.match(/^(imdb|tvdb|tmdb):\/\/(.+)$/i);
      if (m) {
        provider = m[1].toLowerCase();
        id       = m[2];
      } else {
        /* 2) Lien IMDb complet ------------------------------------ */
        m = guid.match(/imdb\.com\/title\/(tt\d+)/i);
        if (m) {
          provider = 'imdb';
          id       = m[1];
        } else {
          /* 3) Lien TMDB complet ---------------------------------- */
          m = guid.match(/(?:tmdb|themoviedb).*?\/(\d+)/i);
          if (m) {
            provider = 'tmdb';
            id       = m[1];
          }
        }
      }
    }

    /* -------- type film / série --- */
    const rawType = (item.categories?.[0] || item.category || '').toLowerCase();
    const type    = rawType === 'show' ? 'show' : 'movie';

    return { title, year, provider, id, type };
  });
}
