// index.js
import { loadConfig } from './utils/configLoader.js';
import { fetchWatchlist } from './utils/rssReader.js';
import { checkIfInPlex, clearScanCache } from './utils/plexChecker.js'; // Assurez-vous d'avoir remplacé le fichier utils/plexChecker.js
import { getDiscordClient, buildAddedEmbed, buildPendingEmbed, sendOrUpdateEmbed } from './utils/discordClient.js';
import fs from 'fs';

console.log('✅ Lancement du bot Plex Watchlist (Mode VF)...');

const config = loadConfig();
const FILE   = './watchlist.json';

let data = { messages: { pending: null }, entries: [] };
if (fs.existsSync(FILE)) { data = JSON.parse(fs.readFileSync(FILE, 'utf-8')); }

async function run() {
  try {
    // On vide le cache de scan au début de chaque cycle pour avoir des données fraîches
    clearScanCache();
    
    const now    = Date.now();
    const client = await getDiscordClient(config.discordBotToken);
    console.log(`\n=== 🔁 Scan lancé à ${new Date().toLocaleTimeString()} ===`);

    const sources = Array.isArray(config.rssUrls) ? config.rssUrls : [config.rssUrl];
    // Récupération des items RSS
    const allItems = (await Promise.all(sources.map(fetchWatchlist))).flat();
    console.log(`📰 ${allItems.length} éléments dans les flux RSS.`);

    const addedThisScan = [];

    for (const it of allItems) {
      const { title, year, provider, id, type } = it;

      // Récupération intelligente dans le fichier local (ID > Titre)
      let existing = data.entries.find(e => {
        if (e.provider && e.id && provider && id) return e.provider === provider && e.id === id;
        return e.title === title && e.type === type;
      });

      // 🔍 SCAN PLEX : Vérification systématique (Fiabilité > Vitesse)
      // On interroge Plex à chaque fois pour être sûr que le contenu est toujours là
      const plexResult = await checkIfInPlex(title, year, type, config, provider, id);
      const isInLib = plexResult.found;
      const plexTitle = plexResult.plexTitle;

      if (!existing) {
        existing = {
          title:   isInLib && plexTitle ? plexTitle : title,
          year, type, provider, id,
          status:  isInLib ? 'added' : 'pending',
          addedAt: isInLib ? now : null
        };
        data.entries.push(existing);
        console.log(`🆕 "${title}" -> ${isInLib ? `✅ Trouvé : "${plexTitle}"` : '🕓 En attente'}`);
        if (isInLib) addedThisScan.push(existing);

      } else {
        // Si l'élément existait déjà...
        
        // 1. Mise à jour du titre si Plex en a trouvé un meilleur (ex: Titre FR)
        if (isInLib && plexTitle && existing.title !== plexTitle) {
           console.log(`🇫🇷 Traduction titre : "${existing.title}" ➔ "${plexTitle}"`);
           existing.title = plexTitle;
        }
        
        // 2. Mise à jour du statut (Pending -> Added)
        if (isInLib && existing.status !== 'added') {
          existing.status  = 'added';
          existing.addedAt = now;
          console.log(`✅ "${existing.title}" est maintenant disponible !`);
          addedThisScan.push(existing);
        }

        // 3. Rétrogradation (Added -> Pending) si le film a disparu de Plex
        if (!isInLib && existing.status === 'added') {
            existing.status = 'pending';
            console.log(`⚠️ "${existing.title}" n'est plus détecté dans Plex -> Retour en attente.`);
        }
      }
    }

    // NETTOYAGE : On retire ce qui n'est plus dans le RSS (sauf si déjà ajouté)
    const beforeCount = data.entries.length;
    data.entries = data.entries.filter(entry => {
      if (entry.status === 'added') return true; // On garde l'historique des ajouts
      const existsInRss = allItems.some(rssItem => {
        if (rssItem.provider && rssItem.id && entry.provider && entry.id) return rssItem.provider === entry.provider && rssItem.id === entry.id;
        return rssItem.title === entry.title;
      });
      if (!existsInRss) console.log(`🗑️ Supprimé (plus dans RSS) : "${entry.title}"`);
      return existsInRss;
    });
    if (beforeCount - data.entries.length > 0) console.log(`🧹 Nettoyage terminé.`);

    // NOTIFS DISCORD
    // On utilise addedThisScan qui est plus fiable que le timestamp
    if (addedThisScan.length > 0 && addedThisScan.length < 50) { 
      const emb = buildAddedEmbed(addedThisScan);
      const ch  = await client.channels.fetch(config.discordChannelId);
      await ch.send({ embeds: [emb] });
    }

    const pending = data.entries.filter(e => e.status === 'pending');
    const embPend = buildPendingEmbed(pending);
    await sendOrUpdateEmbed({ client, channelId: config.discordChannelId, messageId: data.messages.pending, embed: embPend });

    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    console.log('💾 watchlist.json mis à jour.');
  } catch (error) {
    console.error("❌ Erreur critique lors du scan :", error);
  }
}

run();          
function scheduleNext () {
  const now = new Date(); const next = new Date(); next.setHours(24, 0, 0, 0);
  setTimeout(() => { run(); setInterval(run, 24 * 60 * 60 * 1000); }, next - now);
}
export async function runScan() { await run(); return { addedFilms: 0, addedShows: 0 }; } 
export function getState() { return { pendingFilms: 0, pendingShows: 0, entries: [], history: [] }; }