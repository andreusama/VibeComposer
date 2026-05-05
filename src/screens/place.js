import { setState } from '../state/store.js';

// ─── Leaflet is loaded via CDN in index.html ───────────────────────────────────

let map        = null;
let marker     = null;
let selectedCoords = null;
let selectedAddress = '';

function initMap(lat = 41.3851, lng = 2.1734) {
  if (map) { map.remove(); map = null; }

  map = L.map('place-map', { zoomControl: true, attributionControl: false }).setView([lat, lng], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(map);

  // Custom pin icon
  const icon = L.divIcon({
    className: '',
    html: `<div class="map-pin"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  // Click to drop pin
  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    placePin(lat, lng, icon);
    selectedCoords = { lat, lng };
    // Reverse geocode
    const addr = await reverseGeocode(lat, lng);
    selectedAddress = addr;
    const input = document.getElementById('place-input');
    if (input) {
      input.value = addr;
      updateConfirmLabel(addr);
    }
  });
}

function placePin(lat, lng, icon) {
  if (!icon) {
    icon = L.divIcon({ className: '', html: `<div class="map-pin"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  }
  if (marker) marker.remove();
  marker = L.marker([lat, lng], { icon }).addTo(map);
}

async function geocodeAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await resp.json();
  return data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name } : null;
}

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
  const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await resp.json();
  if (!data.address) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const a = data.address;
  const parts = [a.road, a.house_number, a.city || a.town || a.village, a.country].filter(Boolean);
  return parts.join(', ');
}

function updateConfirmLabel(addr) {
  const label = document.getElementById('confirm-label');
  if (label) label.textContent = addr ? `📍 ${addr.slice(0, 60)}${addr.length > 60 ? '…' : ''}` : '';
}

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const skip = state.skipPlace;

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">${state.phrase.length > 40 ? state.phrase.slice(0, 40) + '…' : state.phrase}</span>
    </div>
    <div class="muse-screen">

      <div class="muse-step-label">02 — the place</div>
      <div class="muse-prompt">where does this song live?</div>
      <div class="muse-sub">search for a place or tap the map to drop a pin.</div>

      <div class="place-search-row ${skip ? 'hidden' : ''}">
        <input type="text" id="place-input" class="place-input"
          placeholder="Carrer de Provença 318, Barcelona…"
          value="${state.place || ''}" />
        <button class="search-btn" id="place-search-btn">search</button>
      </div>

      <div id="place-map" class="place-map ${skip ? 'hidden' : ''}"></div>

      <div class="confirm-label" id="confirm-label">
        ${state.place ? `📍 ${state.place}` : ''}
      </div>

      <label class="skip-label">
        <input type="checkbox" id="skip-place" ${skip ? 'checked' : ''} />
        <div class="skip-box ${skip ? 'checked' : ''}">${skip ? '✓' : ''}</div>
        <span>No physical place</span>
      </label>

      <div class="muse-footer">
        <button class="continue-btn secondary" id="place-back">← back</button>
        <button class="continue-btn enabled" id="place-continue">continue →</button>
      </div>

    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const skipCheck = document.getElementById('skip-place');
  const skipVis   = document.querySelector('.skip-box');
  const mapEl     = document.getElementById('place-map');
  const searchRow = document.querySelector('.place-search-row');

  // Restore previous selection if any
  selectedAddress = state.place || '';
  selectedCoords  = null;

  // Init map if not skipped
  if (!state.skipPlace) {
    setTimeout(() => {
      initMap();
      if (state.place) updateConfirmLabel(state.place);
    }, 50);
  }

  // Search button
  document.getElementById('place-search-btn').addEventListener('click', async () => {
    const query = document.getElementById('place-input').value.trim();
    if (!query) return;
    const btn = document.getElementById('place-search-btn');
    btn.textContent = '…';
    const result = await geocodeAddress(query);
    btn.textContent = 'search';
    if (result) {
      map.setView([result.lat, result.lng], 15);
      placePin(result.lat, result.lng);
      selectedCoords  = { lat: result.lat, lng: result.lng };
      selectedAddress = query;
      updateConfirmLabel(query);
    }
  });

  // Search on enter
  document.getElementById('place-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('place-search-btn').click();
  });

  // Skip toggle
  skipCheck.addEventListener('change', () => {
    const skip = skipCheck.checked;
    skipVis.classList.toggle('checked', skip);
    skipVis.textContent = skip ? '✓' : '';
    mapEl.classList.toggle('hidden', skip);
    searchRow.classList.toggle('hidden', skip);
    if (!skip && !map) setTimeout(initMap, 50);
  });

  document.getElementById('place-back').addEventListener('click', () => {
    if (map) { map.remove(); map = null; }
    setState({ screen: 'muse' });
  });

  document.getElementById('place-continue').addEventListener('click', () => {
    if (map) { map.remove(); map = null; }
    setState({
      place:     skipCheck.checked ? '' : (selectedAddress || document.getElementById('place-input').value.trim()),
      skipPlace: skipCheck.checked,
      screen:    'photo',
    });
  });
}
