// utils/discordClient.js
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

let client = null;

export async function getDiscordClient(token) {
  if (client) return client;
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });
  await client.login(token);
  return client;
}

export async function sendOrUpdateEmbed({ client, channelId, messageId = null, embed }) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return null;

  let msg;
  if (messageId) {
    try {
      msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
    } catch (err) {
      if (err.code === 10008) {
        console.warn(`⚠️ Ancien message introuvable (${messageId}), envoi d'un nouveau.`);
        msg = await channel.send({ embeds: [embed] });
      } else {
        console.error('❌ Erreur Discord (fetch/edit message) :', err);
        return null;
      }
    }
  } else {
    msg = await channel.send({ embeds: [embed] });
  }

  return msg.id;
}

export function buildAddedEmbed(list) {
  const desc = list
    .map(e => `✅ **${e.title}** (${e.year || '????'})`)
    .join('\n');

  return new EmbedBuilder()
    .setTitle('🎉 Nouveaux ajouts Plex')
    .setDescription(desc || '*Rien de nouveau…*')
    .setColor(0x2ecc71)
    .setFooter({ text: 'Plex Watchlist Bot' })
    .setTimestamp();
}

function chunkLines(lines, maxLen = 1024) {
  const chunks = [];
  let current = [], length = 0;
  for (const line of lines) {
    const len = line.length + 1;
    if (length + len > maxLen) {
      chunks.push(current);
      current = [line];
      length = len;
    } else {
      current.push(line);
      length += len;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function buildPendingEmbed(entries) {
  const films  = entries.filter(e => e.type === 'movie');
  const shows  = entries.filter(e => e.type === 'show');

  const filmsCount = films.length;
  const showsCount = shows.length;

  // Prépare les lignes
  const filmLines = filmsCount
    ? films.map(e => `🟡 ${e.title} (${e.year || '????'})`)
    : ['*Aucun film en attente.*'];
  const showLines = showsCount
    ? shows.map(e => `🟡 ${e.title} (${e.year || '????'})`)
    : ['*Aucune série en attente.*'];

  // Découpe en chunks ≤1024 caractères
  const filmChunks = chunkLines(filmLines);
  const showChunks = chunkLines(showLines);

  // Construis l’embed
  const embed = new EmbedBuilder()
    .setTitle('🕓 Contenu en attente d’ajout')
    .setColor(0xf1c40f)
    .setFooter({ text: 'Dernière mise à jour' })
    .setTimestamp();

  // Ajout des champs avec compteurs entre parenthèses
  filmChunks.forEach((chunk, i) => {
    embed.addFields({
      name: `🎬 Films (${filmsCount})${filmChunks.length > 1 ? ` (${i+1}/${filmChunks.length})` : ''}`,
      value: chunk.join('\n'),
      inline: true
    });
  });

  showChunks.forEach((chunk, i) => {
    embed.addFields({
      name: `📺 Séries (${showsCount})${showChunks.length > 1 ? ` (${i+1}/${showChunks.length})` : ''}`,
      value: chunk.join('\n'),
      inline: true
    });
  });

  return embed;
}


