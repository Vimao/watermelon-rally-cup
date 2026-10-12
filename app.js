/* WRC Season Tracker - frontend logic
 * Łączy się z backendem Google Apps Script (Web App /exec).
 */

(function () {
  'use strict';

  var API_URL_KEY = 'wrc_api_url';
  var EDITOR_TOKEN_KEY = 'wrc_editor_token';
  var POLL_INTERVAL_MS = 8000;

  // Domyślny adres Web App. Zapisany w localStorage URL ma pierwszeństwo,
  // więc edytor może go nadpisać przez ⚙ API bez zmiany kodu.
  var DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbzM9ry_M69mlbhCAAjTIPXAeGrETDLKVHSzEvsDwkez6z8_BfEWqNEmeelrAckyL_UNDg/exec';

  // --- Stan aplikacji ---
  var state = {
    apiUrl: localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL,
    editorToken: localStorage.getItem(EDITOR_TOKEN_KEY) || '',
    seasons: [],
    races: [],
    results: [],
    selectedSeasonId: null,
    view: 'season',        // 'season' | 'race'
    selectedRaceId: null,   // dla widoku 'race'
    loading: false
  };

  var pollTimer = null;

  // Edytor = token ustawiony. Pusty token => tryb tylko do odczytu.
  function isEditor() { return !!state.editorToken; }

  // --- Skróty DOM ---
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    configPanel: $('configPanel'),
    apiUrlInput: $('apiUrlInput'),
    editorTokenInput: $('editorTokenInput'),
    saveApiUrlBtn: $('saveApiUrlBtn'),
    cancelApiUrlBtn: $('cancelApiUrlBtn'),
    configError: $('configError'),
    appMain: $('appMain'),
    connStatus: $('connStatus'),
    roleBadge: $('roleBadge'),
    refreshBtn: $('refreshBtn'),
    editApiBtn: $('editApiBtn'),

    seasonForm: $('seasonForm'),
    seasonName: $('seasonName'),
    seasonList: $('seasonList'),

    raceFormPanel: $('raceFormPanel'),
    raceForm: $('raceForm'),
    raceRegion: $('raceRegion'),
    raceTrack: $('raceTrack'),
    raceWeather: $('raceWeather'),

    resultFormPanel: $('resultFormPanel'),
    resultForm: $('resultForm'),
    resultRace: $('resultRace'),
    resultUser: $('resultUser'),
    timeMin: $('timeMin'),
    timeSec: $('timeSec'),
    timeMs: $('timeMs'),
    resultControl: $('resultControl'),
    resultGearbox: $('resultGearbox'),

    contentTitle: $('contentTitle'),
    viewToggle: $('viewToggle'),
    raceSelectorWrap: $('raceSelectorWrap'),
    raceSelector: $('raceSelector'),
    viewArea: $('viewArea'),

    toast: $('toast')
  };

  /* ======================= API ======================= */

  function apiGet() {
    return fetch(state.apiUrl + '?action=bootstrap', { method: 'GET' })
      .then(parseResponse);
  }

  function apiPost(payload) {
    // Token edytora dołączany do każdego zapisu (wariant A).
    payload.token = state.editorToken;
    // text/plain -> brak CORS preflight dla Apps Script
    return fetch(state.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(parseResponse);
  }

  function parseResponse(res) {
    return res.text().then(function (text) {
      var json;
      try { json = JSON.parse(text); }
      catch (e) { throw new Error('Nieprawidłowa odpowiedź serwera (nie JSON).'); }
      if (!json.ok) throw new Error(friendlyError(json.error || 'Błąd serwera'));
      return json.data;
    });
  }

  // Zamienia techniczne kody błędów backendu na czytelne komunikaty.
  function friendlyError(msg) {
    if (/UNAUTHORIZED/.test(msg)) {
      return 'Brak uprawnień do edycji. Sprawdź token edytora w ⚙ API.';
    }
    return msg;
  }

  /* ======================= Ładowanie danych ======================= */

  function refresh(opts) {
    opts = opts || {};
    if (!state.apiUrl) return Promise.resolve();
    if (state.loading) return Promise.resolve();
    state.loading = true;
    if (!opts.silent) setConn('unknown', 'odświeżanie…');

    return apiGet()
      .then(function (data) {
        state.seasons = (data.seasons || []).slice().sort(byCreatedAt);
        state.races = data.races || [];
        state.results = data.results || [];

        // Walidacja zaznaczonego sezonu
        if (state.selectedSeasonId &&
            !state.seasons.some(function (s) { return s.seasonId === state.selectedSeasonId; })) {
          state.selectedSeasonId = null;
        }
        if (!state.selectedSeasonId && state.seasons.length) {
          state.selectedSeasonId = state.seasons[0].seasonId;
        }
        setConn('ok', 'połączono');
        renderAll();
      })
      .catch(function (err) {
        setConn('err', 'błąd połączenia');
        if (!opts.silent) showToast(err.message, 'err');
      })
      .then(function () { state.loading = false; });
  }

  function byCreatedAt(a, b) {
    return String(a.createdAt).localeCompare(String(b.createdAt));
  }

  /* ======================= Render ======================= */

  function renderAll() {
    renderRoleBadge();
    renderSeasonList();
    renderSidebarForms();
    renderContent();
  }

  function renderRoleBadge() {
    if (!state.apiUrl) {
      el.roleBadge.classList.add('hidden');
      return;
    }
    el.roleBadge.classList.remove('hidden');
    if (isEditor()) {
      el.roleBadge.className = 'role-badge role-editor';
      el.roleBadge.textContent = '✎ Edytor';
    } else {
      el.roleBadge.className = 'role-badge role-viewer';
      el.roleBadge.textContent = '👁 Tylko odczyt';
    }
  }

  function renderSeasonList() {
    el.seasonList.innerHTML = '';
    if (!state.seasons.length) {
      var li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'Brak sezonów. Utwórz pierwszy powyżej.';
      el.seasonList.appendChild(li);
      return;
    }
    state.seasons.forEach(function (s) {
      var raceCount = state.races.filter(function (r) { return r.seasonId === s.seasonId; }).length;
      var li = document.createElement('li');
      li.className = 'season-item' + (s.seasonId === state.selectedSeasonId ? ' active' : '');
      var delBtnHtml = isEditor() ? '<button class="icon-btn" title="Usuń sezon">🗑</button>' : '';
      li.innerHTML =
        '<div>' +
          '<div class="season-name"></div>' +
          '<div class="season-meta">' + raceCount + ' tras</div>' +
        '</div>' + delBtnHtml;
      li.querySelector('.season-name').textContent = s.name;
      li.addEventListener('click', function (e) {
        if (e.target.classList.contains('icon-btn')) return;
        selectSeason(s.seasonId);
      });
      var delBtn = li.querySelector('.icon-btn');
      if (delBtn) {
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          confirmDeleteSeason(s);
        });
      }
      el.seasonList.appendChild(li);
    });
  }

  function renderSidebarForms() {
    var editor = isEditor();
    var hasSeason = !!state.selectedSeasonId;
    var seasonRaces = racesOfSelectedSeason();

    // Formularz sezonu i wyścigu tylko dla edytora.
    el.seasonForm.classList.toggle('hidden', !editor);
    el.raceFormPanel.classList.toggle('hidden', !editor || !hasSeason);
    el.resultFormPanel.classList.toggle('hidden', !editor || !hasSeason || seasonRaces.length === 0);

    // Lista tras w formularzu wyniku
    if (editor && hasSeason) {
      fillRaceOptions(el.resultRace, seasonRaces, state.selectedRaceId);
    }
  }

  function renderContent() {
    var season = selectedSeason();
    if (!season) {
      el.contentTitle.textContent = 'Wybierz sezon';
      el.viewToggle.classList.add('hidden');
      el.raceSelectorWrap.classList.add('hidden');
      el.viewArea.innerHTML = '<p class="muted empty-hint">Utwórz lub wybierz sezon, aby zobaczyć wyniki.</p>';
      return;
    }

    el.contentTitle.textContent = 'Sezon: ' + season.name;
    el.viewToggle.classList.remove('hidden');
    updateViewToggleButtons();

    var seasonRaces = racesOfSelectedSeason().slice().sort(byCreatedAt);

    if (state.view === 'race') {
      el.raceSelectorWrap.classList.remove('hidden');
      if (!state.selectedRaceId || !seasonRaces.some(function (r) { return r.raceId === state.selectedRaceId; })) {
        state.selectedRaceId = seasonRaces.length ? seasonRaces[0].raceId : null;
      }
      fillRaceOptions(el.raceSelector, seasonRaces, state.selectedRaceId);
    } else {
      el.raceSelectorWrap.classList.add('hidden');
    }

    el.viewArea.innerHTML = '';

    if (!seasonRaces.length) {
      el.viewArea.innerHTML = '<p class="muted empty-hint">Brak wyścigów w tym sezonie. Dodaj pierwszy w panelu po lewej.</p>';
      return;
    }

    // Klasyfikacja generalna widoczna tylko w widoku całego sezonu.
    if (state.view === 'season') {
      var standings = buildStandingsBlock(seasonRaces);
      if (standings) el.viewArea.appendChild(standings);
    }

    var racesToShow = state.view === 'race'
      ? seasonRaces.filter(function (r) { return r.raceId === state.selectedRaceId; })
      : seasonRaces;

    racesToShow.forEach(function (race) {
      el.viewArea.appendChild(buildRaceBlock(race));
    });
  }

  /* ======================= Klasyfikacja generalna ======================= */

  // System punktowy WRC: 1.->25, 2.->18, ... reszta 0.
  var POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

  function pointsForPosition(position) {
    return position >= 1 && position <= POINTS_TABLE.length ? POINTS_TABLE[position - 1] : 0;
  }

  // Zlicza punkty i łączny czas użytkowników po wszystkich trasach sezonu.
  // Klucz zawodnika: znormalizowana nazwa (bez względu na wielkość liter).
  function computeStandings(seasonRaces) {
    var byUser = {}; // key -> { name, points, wins, starts, totalMs }
    var totalRaces = seasonRaces.length;

    seasonRaces.forEach(function (race) {
      var rows = state.results
        .filter(function (r) { return r.raceId === race.raceId; })
        .map(function (r) { return { ref: r, timeMs: Number(r.timeMs) }; })
        .sort(function (a, b) { return a.timeMs - b.timeMs; });

      rows.forEach(function (row, idx) {
        var pos = idx + 1;
        var key = normalizeName(row.ref.userName);
        if (!byUser[key]) {
          byUser[key] = { name: row.ref.userName, points: 0, wins: 0, starts: 0, totalMs: 0 };
        }
        var entry = byUser[key];
        entry.points += pointsForPosition(pos);
        entry.totalMs += row.timeMs;
        entry.starts += 1;
        if (pos === 1) entry.wins += 1;
        // Zachowaj ostatnią pisownię nazwy czytelnie.
        entry.name = row.ref.userName;
      });
    });

    var list = Object.keys(byUser).map(function (k) { return byUser[k]; });

    // "Komplet" = zawodnik ma wynik na każdej trasie sezonu. Tylko wśród takich
    // zawodników łączny czas jest w pełni porównywalny, więc tam liczymy stratę.
    list.forEach(function (e) { e.complete = totalRaces > 0 && e.starts === totalRaces; });

    return list.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points; // więcej pkt wyżej
      if (b.wins !== a.wins) return b.wins - a.wins;          // tie-break: zwycięstwa
      if (a.totalMs !== b.totalMs) return a.totalMs - b.totalMs; // potem krótszy czas
      return a.name.localeCompare(b.name);                   // na końcu alfabetycznie
    });
  }

  function normalizeName(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  }

  function buildStandingsBlock(seasonRaces) {
    var standings = computeStandings(seasonRaces);
    if (!standings.length) return null;

    var leaderPoints = standings[0].points;

    // Odniesienie dla straty czasowej: najszybsza suma wśród zawodników z kompletem
    // przejazdów (porównywalnych). Jeśli nikt nie ma kompletu, strata czasowa jest N/D.
    var completeTimes = standings
      .filter(function (e) { return e.complete; })
      .map(function (e) { return e.totalMs; });
    var timeLeaderMs = completeTimes.length ? Math.min.apply(null, completeTimes) : null;

    var block = document.createElement('div');
    block.className = 'race-block standings-block';

    var header = document.createElement('div');
    header.className = 'race-block-header';
    header.innerHTML =
      '<div><div class="race-title">🏆 Klasyfikacja generalna</div>' +
      '<div class="race-sub">Punktacja WRC (25-18-15-12-10-8-6-4-2-1) sumowana po trasach</div></div>';
    block.appendChild(header);

    var table = document.createElement('table');
    table.className = 'results';
    table.innerHTML =
      '<thead><tr>' +
        '<th class="pos">#</th>' +
        '<th>Użytkownik</th>' +
        '<th>Punkty</th>' +
        '<th>Strata (pkt)</th>' +
        '<th>Łączny czas</th>' +
        '<th>Strata (czas)</th>' +
        '<th>Zwycięstwa</th>' +
        '<th>Starty</th>' +
      '</tr></thead>';

    var tbody = document.createElement('tbody');
    standings.forEach(function (entry, idx) {
      var pos = idx + 1;
      var ptsGap = leaderPoints - entry.points;

      var tr = document.createElement('tr');

      var tdPos = document.createElement('td');
      tdPos.className = 'pos' + (pos === 1 ? ' pos-1' : '');
      tdPos.textContent = pos === 1 ? '🥇' : pos;

      var tdUser = document.createElement('td');
      tdUser.textContent = entry.name;

      var tdPts = document.createElement('td');
      tdPts.className = 'time-cell';
      tdPts.textContent = entry.points;

      var tdPtsGap = document.createElement('td');
      tdPtsGap.className = 'gap-cell' + (ptsGap === 0 ? ' gap-leader' : '');
      tdPtsGap.textContent = ptsGap === 0 ? 'lider' : '-' + ptsGap;

      // Łączny czas: zawsze pokazujemy sumę; niepełny komplet oznaczamy znacznikiem.
      var tdTotal = document.createElement('td');
      tdTotal.className = 'time-cell';
      tdTotal.textContent = formatTime(entry.totalMs);
      if (!entry.complete) {
        var inc = document.createElement('span');
        inc.className = 'tag tag-partial';
        inc.title = 'Niepełny komplet przejazdów (' + entry.starts + '/' + seasonRaces.length + ')';
        inc.textContent = entry.starts + '/' + seasonRaces.length;
        tdTotal.appendChild(document.createTextNode(' '));
        tdTotal.appendChild(inc);
      }

      // Strata czasowa: tylko dla zawodników z kompletem, względem najszybszej sumy.
      var tdTimeGap = document.createElement('td');
      tdTimeGap.className = 'gap-cell';
      if (timeLeaderMs === null || !entry.complete) {
        tdTimeGap.textContent = '—';
        tdTimeGap.classList.add('muted');
      } else {
        var tGap = entry.totalMs - timeLeaderMs;
        if (tGap === 0) {
          tdTimeGap.textContent = 'lider';
          tdTimeGap.classList.add('gap-leader');
        } else {
          tdTimeGap.textContent = '+' + formatGap(tGap);
        }
      }

      var tdWins = document.createElement('td');
      tdWins.textContent = entry.wins;

      var tdStarts = document.createElement('td');
      tdStarts.textContent = entry.starts;

      tr.appendChild(tdPos);
      tr.appendChild(tdUser);
      tr.appendChild(tdPts);
      tr.appendChild(tdPtsGap);
      tr.appendChild(tdTotal);
      tr.appendChild(tdTimeGap);
      tr.appendChild(tdWins);
      tr.appendChild(tdStarts);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    block.appendChild(table);
    return block;
  }

  function buildRaceBlock(race) {
    var block = document.createElement('div');
    block.className = 'race-block';

    var header = document.createElement('div');
    header.className = 'race-block-header';

    var left = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'race-title';
    title.textContent = race.trackName;
    var sub = document.createElement('div');
    sub.className = 'race-sub';
    sub.textContent = race.region;
    var weather = document.createElement('span');
    weather.className = 'weather-badge';
    weather.textContent = race.weather;
    sub.appendChild(weather);
    left.appendChild(title);
    left.appendChild(sub);

    header.appendChild(left);
    if (isEditor()) {
      var delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = 'Usuń wyścig';
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', function () { confirmDeleteRace(race); });
      header.appendChild(delBtn);
    }
    block.appendChild(header);

    // Wyniki posortowane rosnąco po czasie (najlepszy = najmniejszy)
    var rows = state.results
      .filter(function (r) { return r.raceId === race.raceId; })
      .map(function (r) { return { ref: r, timeMs: Number(r.timeMs) }; })
      .sort(function (a, b) { return a.timeMs - b.timeMs; });

    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'no-results';
      empty.textContent = 'Brak wyników dla tej trasy.';
      block.appendChild(empty);
      return block;
    }

    var leaderMs = rows[0].timeMs;

    var table = document.createElement('table');
    table.className = 'results';
    table.innerHTML =
      '<thead><tr>' +
        '<th class="pos">#</th>' +
        '<th>Użytkownik</th>' +
        '<th>Czas</th>' +
        '<th>Strata do 1.</th>' +
        '<th>Sterowanie</th>' +
        '<th>Skrzynia</th>' +
        '<th></th>' +
      '</tr></thead>';

    var tbody = document.createElement('tbody');
    rows.forEach(function (row, idx) {
      var r = row.ref;
      var pos = idx + 1;
      var gap = row.timeMs - leaderMs;

      var tr = document.createElement('tr');

      var tdPos = document.createElement('td');
      tdPos.className = 'pos' + (pos === 1 ? ' pos-1' : '');
      tdPos.textContent = pos === 1 ? '🥇' : pos;

      var tdUser = document.createElement('td');
      tdUser.textContent = r.userName;

      var tdTime = document.createElement('td');
      tdTime.className = 'time-cell';
      tdTime.textContent = formatTime(row.timeMs);

      var tdGap = document.createElement('td');
      tdGap.className = 'gap-cell' + (gap === 0 ? ' gap-leader' : '');
      tdGap.textContent = gap === 0 ? 'lider' : '+' + formatGap(gap);

      var tdControl = document.createElement('td');
      tdControl.innerHTML = '<span class="tag"></span>';
      tdControl.querySelector('.tag').textContent = r.control;

      var tdGear = document.createElement('td');
      tdGear.innerHTML = '<span class="tag"></span>';
      tdGear.querySelector('.tag').textContent = r.gearbox;

      var tdDel = document.createElement('td');
      if (isEditor()) {
        var rdel = document.createElement('button');
        rdel.className = 'icon-btn';
        rdel.title = 'Usuń wynik';
        rdel.textContent = '✕';
        rdel.addEventListener('click', function () { confirmDeleteResult(r); });
        tdDel.appendChild(rdel);
      }

      tr.appendChild(tdPos);
      tr.appendChild(tdUser);
      tr.appendChild(tdTime);
      tr.appendChild(tdGap);
      tr.appendChild(tdControl);
      tr.appendChild(tdGear);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    block.appendChild(table);
    return block;
  }

  function updateViewToggleButtons() {
    var buttons = el.viewToggle.querySelectorAll('.btn-toggle');
    buttons.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
  }

  /* ======================= Helpers danych ======================= */

  function selectedSeason() {
    return state.seasons.filter(function (s) { return s.seasonId === state.selectedSeasonId; })[0] || null;
  }

  function racesOfSelectedSeason() {
    return state.races.filter(function (r) { return r.seasonId === state.selectedSeasonId; });
  }

  function fillRaceOptions(selectEl, races, selectedId) {
    selectEl.innerHTML = '';
    races.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.raceId;
      opt.textContent = r.trackName + ' (' + r.region + ')';
      if (r.raceId === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  /* ======================= Formatowanie czasu ======================= */

  // ms -> "m:ss.mmm" lub "ss.mmm"
  function formatTime(ms) {
    ms = Math.max(0, Math.round(ms));
    var minutes = Math.floor(ms / 60000);
    var seconds = Math.floor((ms % 60000) / 1000);
    var millis = ms % 1000;
    var secStr = (minutes > 0 ? pad(seconds, 2) : String(seconds));
    return (minutes > 0 ? minutes + ':' : '') + secStr + '.' + pad(millis, 3);
  }

  // różnica w ms -> "s.mmm" (lub "m:ss.mmm" przy dużych różnicach)
  function formatGap(ms) {
    ms = Math.round(ms);
    if (ms >= 60000) return formatTime(ms);
    var seconds = Math.floor(ms / 1000);
    var millis = ms % 1000;
    return seconds + '.' + pad(millis, 3);
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }

  function readTimeMsFromForm() {
    var min = parseInt(el.timeMin.value, 10) || 0;
    var sec = parseInt(el.timeSec.value, 10) || 0;
    var ms = parseInt(el.timeMs.value, 10) || 0;
    return (min * 60000) + (sec * 1000) + ms;
  }

  /* ======================= Akcje ======================= */

  function selectSeason(seasonId) {
    state.selectedSeasonId = seasonId;
    state.selectedRaceId = null;
    renderAll();
  }

  function createSeason(name) {
    return apiPost({ action: 'addSeason', name: name })
      .then(function (season) {
        showToast('Utworzono sezon: ' + season.name, 'ok');
        state.selectedSeasonId = season.seasonId;
        state.selectedRaceId = null;
        return refresh({ silent: true });
      });
  }

  function createRace(data) {
    data.action = 'addRace';
    data.seasonId = state.selectedSeasonId;
    return apiPost(data).then(function (race) {
      showToast('Dodano wyścig: ' + race.trackName, 'ok');
      return refresh({ silent: true });
    });
  }

  function createResult(data) {
    data.action = 'addResult';
    data.seasonId = state.selectedSeasonId;
    return apiPost(data).then(function () {
      showToast('Dodano wynik', 'ok');
      return refresh({ silent: true });
    }).catch(function (err) {
      // Unikatowość userName per trasa: backend zwraca DUPLICATE_USER.
      if (/DUPLICATE_USER/.test(err.message)) {
        if (confirm('Użytkownik "' + data.userName +
            '" ma już wynik na tej trasie.\nNadpisać poprzedni wynik?')) {
          data.overwrite = true;
          return apiPost(data).then(function () {
            showToast('Nadpisano wynik', 'ok');
            return refresh({ silent: true });
          });
        }
        return; // użytkownik anulował
      }
      throw err;
    });
  }

  function confirmDeleteSeason(season) {
    if (!confirm('Usunąć sezon "' + season.name + '" wraz ze wszystkimi wyścigami i wynikami?')) return;
    apiPost({ action: 'deleteSeason', seasonId: season.seasonId })
      .then(function () {
        if (state.selectedSeasonId === season.seasonId) state.selectedSeasonId = null;
        showToast('Usunięto sezon', 'ok');
        return refresh({ silent: true });
      })
      .catch(function (err) { showToast(err.message, 'err'); });
  }

  function confirmDeleteRace(race) {
    if (!confirm('Usunąć wyścig "' + race.trackName + '" wraz z wynikami?')) return;
    apiPost({ action: 'deleteRace', raceId: race.raceId })
      .then(function () {
        showToast('Usunięto wyścig', 'ok');
        return refresh({ silent: true });
      })
      .catch(function (err) { showToast(err.message, 'err'); });
  }

  function confirmDeleteResult(result) {
    if (!confirm('Usunąć wynik użytkownika "' + result.userName + '"?')) return;
    apiPost({ action: 'deleteResult', resultId: result.resultId })
      .then(function () {
        showToast('Usunięto wynik', 'ok');
        return refresh({ silent: true });
      })
      .catch(function (err) { showToast(err.message, 'err'); });
  }

  /* ======================= UI feedback ======================= */

  function setConn(kind, text) {
    el.connStatus.className = 'conn-status conn-' + kind;
    el.connStatus.textContent = text;
  }

  var toastTimer = null;
  function showToast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = 'toast ' + (kind === 'err' ? 'toast-err' : 'toast-ok');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.add('hidden'); }, 3500);
  }

  /* ======================= Konfiguracja / init ======================= */

  function showConfig(show) {
    el.configPanel.classList.toggle('hidden', !show);
    el.appMain.classList.toggle('hidden', show);
    // Przycisk "Anuluj" ma sens tylko, gdy jest do czego wracać (URL już ustawiony).
    el.cancelApiUrlBtn.classList.toggle('hidden', !state.apiUrl);
    // Przycisk "⚙ API" w nagłówku widoczny, gdy panel jest schowany i URL istnieje.
    el.editApiBtn.classList.toggle('hidden', show || !state.apiUrl);
  }

  // Otwiera panel konfiguracji z wczytanym bieżącym URL i tokenem (edycja istniejącego).
  function openConfig() {
    el.apiUrlInput.value = state.apiUrl || '';
    el.editorTokenInput.value = state.editorToken || '';
    el.configError.classList.add('hidden');
    showConfig(true);
  }

  // Zamyka panel bez zmian (dostępne tylko gdy URL już skonfigurowany).
  function cancelConfig() {
    if (!state.apiUrl) return;
    el.configError.classList.add('hidden');
    showConfig(false);
  }

  function saveApiUrl() {
    var url = el.apiUrlInput.value.trim();
    el.configError.classList.add('hidden');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
      el.configError.textContent = 'URL powinien mieć postać https://script.google.com/macros/s/.../exec';
      el.configError.classList.remove('hidden');
      return;
    }
    var changed = url !== state.apiUrl;
    state.apiUrl = url;
    localStorage.setItem(API_URL_KEY, url);

    // Token edytora: pusty => tryb tylko do odczytu.
    var token = el.editorTokenInput.value.trim();
    state.editorToken = token;
    if (token) {
      localStorage.setItem(EDITOR_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(EDITOR_TOKEN_KEY);
    }

    // Po zmianie arkusza wyczyść dane i zaznaczenia ze starego źródła,
    // aby nie pokazywać ich przed pierwszym odświeżeniem z nowego URL.
    if (changed) {
      state.seasons = [];
      state.races = [];
      state.results = [];
      state.selectedSeasonId = null;
      state.selectedRaceId = null;
    }

    showConfig(false);
    // Natychmiast odzwierciedl tryb (edytor/widz) i ewentualne czyszczenie danych.
    renderAll();
    startPolling();
    refresh();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () { refresh({ silent: true }); }, POLL_INTERVAL_MS);
  }

  function bindEvents() {
    el.saveApiUrlBtn.addEventListener('click', saveApiUrl);
    el.cancelApiUrlBtn.addEventListener('click', cancelConfig);
    el.editApiBtn.addEventListener('click', openConfig);
    el.apiUrlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveApiUrl();
      if (e.key === 'Escape') cancelConfig();
    });

    el.refreshBtn.addEventListener('click', function () { refresh(); });

    el.seasonForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = el.seasonName.value.trim();
      if (!name) return;
      el.seasonName.value = '';
      createSeason(name).catch(function (err) { showToast(err.message, 'err'); });
    });

    el.raceForm.addEventListener('submit', function (e) {
      e.preventDefault();
      createRace({
        region: el.raceRegion.value.trim(),
        trackName: el.raceTrack.value.trim(),
        weather: el.raceWeather.value
      }).then(function () {
        el.raceForm.reset();
      }).catch(function (err) { showToast(err.message, 'err'); });
    });

    el.resultForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var timeMs = readTimeMsFromForm();
      if (timeMs <= 0) {
        showToast('Podaj czas przejazdu większy od zera.', 'err');
        return;
      }
      var raceId = el.resultRace.value;
      if (!raceId) {
        showToast('Wybierz trasę.', 'err');
        return;
      }
      createResult({
        raceId: raceId,
        userName: el.resultUser.value.trim(),
        timeMs: timeMs,
        control: el.resultControl.value,
        gearbox: el.resultGearbox.value
      }).then(function () {
        el.resultUser.value = '';
        el.timeMin.value = '';
        el.timeSec.value = '';
        el.timeMs.value = '';
      }).catch(function (err) { showToast(err.message, 'err'); });
    });

    el.viewToggle.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-toggle');
      if (!btn) return;
      state.view = btn.getAttribute('data-view');
      renderContent();
    });

    el.raceSelector.addEventListener('change', function () {
      state.selectedRaceId = el.raceSelector.value;
      renderContent();
    });
  }

  function init() {
    bindEvents();
    if (state.apiUrl) {
      el.apiUrlInput.value = state.apiUrl;
      showConfig(false);
      startPolling();
      refresh();
    } else {
      showConfig(true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
