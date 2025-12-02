// renderer.js
const btn = document.getElementById('btn-refresh');
const pf  = document.getElementById('pending-films');
const ps  = document.getElementById('pending-shows');
const logs= document.getElementById('logs');
const ctx = document.getElementById('sparkline').getContext('2d');
let chart;

// Fonction pour afficher logs
window.api.onLog(msg => {
  const line = document.createElement('div');
  line.textContent = msg;
  logs.appendChild(line);
  logs.scrollTop = logs.scrollHeight;
});

// Met à jour les compteurs et le graphique
async function updateUI() {
  const state = await window.api.getState();
  pf.textContent = state.pendingFilms;
  ps.textContent = state.pendingShows;

  const data = state.history.map(h=>h.pending);
  if (chart) chart.data.labels = data.map((_,i)=>i);
  else {
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels: data.map((_,i)=>i), datasets: [{ data, fill: false, tension: .3 }] },
      options: { plugins:{ legend:{ display:false } }, scales: { x:{ display:false }, y:{ beginAtZero:true } } }
    });
  }
  chart.data.datasets[0].data = data;
  chart.update();
}

// Refresh manuel
btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = '⏳';
  const { addedFilms, addedShows } = await window.api.refresh();
  btn.textContent = '🔄';
  btn.disabled = false;
  window.api.onLog(`➕ Films ajoutés : ${addedFilms}, Séries ajoutées : ${addedShows}`);
  await updateUI();
});

// Initialisation
updateUI();
