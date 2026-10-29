import { createChallenge } from './words.js';

const TEST_DURATION_MS = 60_000;
const API_BASE = String(window.TYPING_CONFIG?.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);

const ui = {
  timer: $('timer'), timerStatus: $('timerStatus'), progress: $('progress'),
  progressFill: $('progressFill'), wordViewport: $('wordViewport'),
  input: $('typingInput'), start: $('startButton'), startLabel: $('startLabel'),
  reset: $('resetButton'), notice: $('notice'), results: $('results'),
  resultCheck: $('resultCheck'), wpm: $('wpmValue'), accuracy: $('accuracyValue'),
  correct: $('correctValue'), errors: $('errorsValue'), shareStatus: $('shareStatus'),
  share: $('shareButton'), copy: $('copyButton'), again: $('againButton')
};

const state = {
  phase: 'ready', target: '', typed: '', charNodes: [], wordElements: [],
  previousLength: 0, activeWord: -1, deadline: null, interval: null,
  startToken: null, shareUrl: null, generation: 0, preparedAt: null
};

const formatNumber = (number) => new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1
}).format(number);

function notice(message = '', tone = '') {
  ui.notice.textContent = message;
  ui.notice.className = `notice${tone ? ` notice--${tone}` : ''}`;
}

function updateTimer(msRemaining = TEST_DURATION_MS) {
  const remaining = Math.max(0, msRemaining);
  const elapsed = TEST_DURATION_MS - remaining;
  ui.timer.textContent = String(Math.ceil(remaining / 1000));
  ui.progressFill.style.width = `${(elapsed / TEST_DURATION_MS) * 100}%`;
  ui.progress.setAttribute('aria-valuenow', String(Math.floor(elapsed / 1000)));
}

function buildWordDisplay(text) {
  ui.wordViewport.replaceChildren();
  state.charNodes = [];
  state.wordElements = [];
  state.previousLength = 0;
  state.activeWord = -1;

  const list = document.createElement('div');
  list.className = 'word-list';
  const fragment = document.createDocumentFragment();
  const words = text.split(' ');
  let position = 0;

  words.forEach((word, wordIndex) => {
    const element = document.createElement('span');
    element.className = 'word';
    const start = position;

    for (const letter of word) {
      const character = document.createElement('span');
      character.className = 'char';
      character.textContent = letter;
      element.append(character);
      state.charNodes.push(character);
      position += 1;
    }

    if (wordIndex < words.length - 1) {
      const separator = document.createElement('span');
      separator.className = 'char char--space';
      separator.textContent = '\u00a0';
      element.append(separator);
      state.charNodes.push(separator);
      position += 1;
    }

    state.wordElements.push({ element, start, end: position });
    fragment.append(element);
  });
  list.append(fragment);
  ui.wordViewport.append(list);
  ui.wordViewport.scrollTop = 0;
}

function updateFeedback() {
  const length = state.typed.length;
  const lastIndex = Math.min(state.charNodes.length - 1,
    Math.max(length, state.previousLength));

  for (let i = 0; i <= lastIndex; i += 1) {
    const node = state.charNodes[i];
    if (!node) continue;
    node.classList.remove('char--correct', 'char--incorrect', 'char--current');
    if (i < length) {
      node.classList.add(state.typed[i] === state.target[i]
        ? 'char--correct' : 'char--incorrect');
    } else if (i === length && (state.phase === 'running' || state.phase === 'armed')) {
      node.classList.add('char--current');
    }
  }
  state.previousLength = length;

  let wordIndex = state.wordElements.findIndex(({ end }) => length < end);
  if (wordIndex === -1) wordIndex = state.wordElements.length - 1;
  if (state.activeWord !== wordIndex) {
    state.wordElements[state.activeWord]?.element.classList.remove('word--active');
    if ((state.phase === 'running' || state.phase === 'armed') && wordIndex >= 0) {
      state.wordElements[wordIndex].element.classList.add('word--active');
      const word = state.wordElements[wordIndex].element;
      const viewport = ui.wordViewport;
      const relativeTop = word.offsetTop - viewport.offsetTop;
      if (relativeTop < viewport.scrollTop + 8 ||
          relativeTop + word.offsetHeight > viewport.scrollTop + viewport.clientHeight - 8) {
        viewport.scrollTop = Math.max(0, relativeTop - 16);
      }
    }
    state.activeWord = wordIndex;
  }
}

function calculateResult(target, typed) {
  let correct = 0;
  for (let i = 0; i < typed.length; i += 1) {
    if (typed[i] === target[i]) correct += 1;
  }
  return {
    wpm: Math.round(correct * 2) / 10,  // correct characters / 5, for exactly 1 minute
    accuracy: typed.length ? Math.round(correct / typed.length * 1000) / 10 : 0,
    correct,
    errors: typed.length - correct
  };
}

function displayResult(result) {
  ui.wpm.textContent = formatNumber(result.wpm);
  ui.accuracy.textContent = `${formatNumber(result.accuracy)} %`;
  ui.correct.textContent = formatNumber(result.correct);
  ui.errors.textContent = formatNumber(result.errors);
  ui.results.hidden = false;
}

function showUnverified(text) {
  ui.resultCheck.textContent = 'Nicht signiert';
  ui.resultCheck.classList.add('result-check--unverified');
  ui.shareStatus.textContent = text;
  ui.share.disabled = true;
  ui.copy.disabled = true;
}

function reset() {
  state.generation += 1; // Invalidates any pending network callbacks.
  if (state.interval !== null) clearInterval(state.interval);
  state.interval = null;
  state.phase = 'ready';
  state.deadline = null;
  state.preparedAt = null;
  state.startToken = null;
  state.shareUrl = null;
  state.target = createChallenge();
  state.typed = '';
  buildWordDisplay(state.target);
  ui.input.value = '';
  ui.input.disabled = true;
  ui.input.placeholder = 'Tab drücken oder Test vorbereiten wählen …';
  ui.start.disabled = false;
  ui.startLabel.textContent = 'Test vorbereiten';
  ui.reset.textContent = 'Neue Wörter';
  ui.timerStatus.textContent = 'Bereit';
  ui.results.hidden = true;
  ui.resultCheck.classList.remove('result-check--unverified');
  notice();
  updateTimer();
}

// A Tab press (or the button) prepares the challenge and focuses the field.
// The 60-second clock starts only when the first character is actually entered.
function arm(target, token) {
  state.phase = 'armed';
  state.target = target;
  state.startToken = token;
  state.preparedAt = performance.now();
  state.typed = '';
  state.deadline = null;
  buildWordDisplay(target);
  updateFeedback();
  ui.input.disabled = false;
  ui.input.value = '';
  ui.input.placeholder = 'Mit dem ersten Zeichen beginnt die Zeit …';
  ui.timerStatus.textContent = 'Wartet auf Eingabe';
  ui.start.disabled = true;
  ui.startLabel.textContent = 'Bereit';
  ui.reset.textContent = 'Neue Wörter';
  updateTimer();
  ui.input.focus();
}

function beginRunning() {
  if (state.phase !== 'armed') return;
  state.phase = 'running';
  state.deadline = performance.now() + TEST_DURATION_MS;
  ui.timerStatus.textContent = 'Läuft';
  updateTimer();
  state.interval = window.setInterval(tick, 75);
}

async function prepare() {
  if (state.phase !== 'ready') return;
  const generation = ++state.generation;
  state.phase = 'loading';
  ui.start.disabled = true;
  ui.startLabel.textContent = 'Wird vorbereitet …';
  ui.timerStatus.textContent = 'Wird vorbereitet';
  notice();

  if (!API_BASE) {
    arm(state.target, null);
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Der Dienst ist nicht erreichbar.');
    if (typeof data.challenge !== 'string' || !data.challenge.includes(' ') ||
        typeof data.token !== 'string') {
      throw new Error('Die Antwort des Servers ist unvollständig.');
    }
    if (generation !== state.generation) return;
    arm(data.challenge, data.token);
  } catch (error) {
    if (generation !== state.generation) return;
    state.phase = 'ready';
    ui.start.disabled = false;
    ui.startLabel.textContent = 'Test vorbereiten';
    ui.timerStatus.textContent = 'Bereit';
    notice(`Start fehlgeschlagen: ${error.message} Prüfe die Worker-URL in config.js.`, 'error');
  }
}

function tick() {
  if (state.phase !== 'running') return;
  const remaining = state.deadline - performance.now();
  updateTimer(remaining);
  if (remaining <= 0) void finish();
}

async function finish() {
  if (state.phase !== 'running') return;
  const generation = state.generation;
  state.phase = 'finished';
  if (state.interval !== null) clearInterval(state.interval);
  state.interval = null;
  ui.input.disabled = true;
  ui.startLabel.textContent = 'Abgeschlossen';
  ui.reset.textContent = 'Neue Wörter';
  ui.timerStatus.textContent = 'Zeit abgelaufen';
  updateTimer(0);
  // Remove the blinking caret, but retain red/green feedback.
  state.charNodes[state.typed.length]?.classList.remove('char--current');
  state.wordElements[state.activeWord]?.element.classList.remove('word--active');
  displayResult(calculateResult(state.target, state.typed));
  state.shareUrl = null;
  showUnverified(state.startToken
    ? 'Das Ergebnis wird auf dem Server geprüft und signiert …'
    : 'Der Test wurde lokal ausgeführt. Für einen unveränderbaren Ergebnislink muss der Worker eingerichtet sein.');
  ui.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!state.startToken) return;

  try {
    const response = await fetch(`${API_BASE}/api/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.startToken, typed: state.typed }),
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Das Ergebnis konnte nicht signiert werden.');
    if (!data.url || !data.result || !String(data.url).startsWith(`${API_BASE}/r/`)) {
      throw new Error('Der Server hat keinen gültigen Ergebnislink geliefert.');
    }
    if (generation !== state.generation) return;
    displayResult(data.result); // Show the server's independently calculated values.
    state.shareUrl = data.url;
    ui.resultCheck.textContent = 'Server-signiert ✓';
    ui.resultCheck.classList.remove('result-check--unverified');
    ui.shareStatus.textContent = 'Fester, signierter Link. Die angezeigten Werte lassen sich nachträglich nicht ändern.';
    ui.share.disabled = false;
    ui.copy.disabled = false;
    notice('Dein Ergebnislink ist bereit zum Teilen.', 'success');
  } catch (error) {
    if (generation !== state.generation) return;
    showUnverified(`Dieses Ergebnis ist nicht verifiziert: ${error.message}`);
    notice('Der Test ist beendet. Ohne Server-Signatur gibt es keinen verifizierbaren Ergebnislink.', 'error');
  }
}

function onInput() {
  if (state.phase === 'armed') {
    if (!ui.input.value) return;
    // Server sessions expire after ten minutes. Avoid starting a run from a
    // stale challenge that could no longer receive a signed result link.
    if (state.startToken && performance.now() - state.preparedAt > 8 * 60_000) {
      reset();
      notice('Die Vorbereitung ist abgelaufen. Bitte Tab erneut drücken.', 'error');
      return;
    }
    beginRunning();
  }
  if (state.phase !== 'running') return;
  if (performance.now() >= state.deadline) {
    ui.input.value = state.typed; // Ignore any keystroke arriving after the 60-second window.
    void finish();
    return;
  }
  // Keep one-line input; pasted / dropped text is blocked separately.
  const cleaned = ui.input.value.replace(/[\r\n\t]/g, ' ').slice(0, state.target.length);
  ui.input.value = cleaned;
  state.typed = cleaned;
  updateFeedback();
}

function onKeyDown(event) {
  if (state.phase === 'running' && performance.now() >= state.deadline) {
    event.preventDefault();
    void finish();
    return;
  }
  // Preserve ordinary Tab navigation once the input is active.
  if (event.key === 'Enter') event.preventDefault();
}

async function copyLink() {
  if (!state.shareUrl) return;
  try {
    await navigator.clipboard.writeText(state.shareUrl);
    notice('Signierter Link in die Zwischenablage kopiert.', 'success');
  } catch {
    // Clipboard APIs may be unavailable in older browsers or insecure localhost setups.
    window.prompt('Signierten Link kopieren:', state.shareUrl);
  }
}

async function shareResult() {
  if (!state.shareUrl) return;
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Mein Tippklar-Ergebnis',
        text: 'Mein verifizierbarer 60-Sekunden-Schreibtest:',
        url: state.shareUrl
      });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  await copyLink();
}

// Tab starts preparation while no interactive element is focused. Tab on
// buttons/links still retains its normal browser-navigation behavior.
function onGlobalKeyDown(event) {
  if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey ||
      event.altKey || event.metaKey || event.defaultPrevented ||
      !['ready', 'finished'].includes(state.phase)) return;
  const active = document.activeElement;
  if (active && (active.isContentEditable ||
      active.matches('a, button, input, textarea, select, [role="button"]'))) return;
  event.preventDefault();
  if (state.phase === 'finished') reset();
  void prepare();
}

document.addEventListener('keydown', onGlobalKeyDown);
ui.start.addEventListener('click', () => void prepare());
ui.reset.addEventListener('click', reset);
ui.again.addEventListener('click', () => {
  reset();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
ui.input.addEventListener('input', onInput);
ui.input.addEventListener('keydown', onKeyDown);
ui.input.addEventListener('paste', (event) => {
  event.preventDefault();
  notice('Einfügen ist deaktiviert. Bitte tippe die Wörter selbst.');
});
ui.input.addEventListener('drop', (event) => event.preventDefault());
ui.input.addEventListener('beforeinput', (event) => {
  if (['insertFromPaste', 'insertFromDrop', 'insertReplacementText'].includes(event.inputType)) {
    event.preventDefault();
  }
});
ui.copy.addEventListener('click', () => void copyLink());
ui.share.addEventListener('click', () => void shareResult());

reset();
