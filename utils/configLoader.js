import fs from 'fs';

export function loadConfig() {
  return JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
}
