// Every overlay is plain HTML over the canvas: real text, real buttons.
import { story, text, t } from '../content';
import { renderMap, legendHtml } from './map';
import { glyphSvg } from './glyphs';
import { exploredFraction, GLYPH_NAMES, type GameState, type Glyph, type Action } from '../core/logic';
import type { Input } from '../engine/input';

type Screen = 'title' | 'reader' | 'map' | 'journal' | 'achievements' | 'pause' | 'settings' | 'error';

export interface UiHost {
  state: GameState;
  playerMarker(): { x: number; z: number; yaw: number } | null;
  hints(): string[];
  begin(newGame: boolean): void;
  resetProgress(): void;
  settingsChanged(reload?: boolean): void;
  hasSave: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function rich(body: string): string {
  return body
    .split('\n\n')
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>').replace(/\[\[(\w+)\]\]/g, (_, g: Glyph) => glyphSvg(g, 26))}</p>`)
    .join('');
}
const KEY_LABEL: Record<Action, string> = { forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', run: 'Run', interact: 'Interact', map: 'Map' };
const keyName = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Shift').replace('ControlLeft', 'Ctrl');

export class UI {
  modal: Screen | null = null;
  private root = document.getElementById('ui')!;
  private el: Record<string, HTMLElement> = {};
  private readerQueue: { id: string; done?: () => void }[] = [];
  private readerDone?: () => void;
  private readerReturn: 'pause' | 'journal' | null = null;
  private toastTimer = 0;
  private captionTimer = 0;
  private zoneTimer = 0;

  constructor(private host: UiHost, private input: Input) {
    const u = story.ui;
    this.root.innerHTML = `
      <div class="hud" data-el="hud" hidden>
        <div class="hud-tl"><div class="zone-name" data-el="zone"></div><div class="objective" data-el="objective"></div></div>
        <div class="hud-tr">
          <button class="chip" data-act="map" aria-label="${u.map}"><span data-el="pct">0%</span> ${u.map}</button>
          <button class="chip" data-act="pause" aria-label="${u.pause}">II</button>
        </div>
        <div class="sound-dir" data-el="soundDir" hidden><span class="arrow" data-el="soundArrow">➤</span><span data-el="soundText"></span></div>
        <div class="toasts" data-el="toasts" aria-live="polite"></div>
        <div class="tip" data-el="tip" hidden></div>
        <div class="caption" data-el="caption" hidden></div>
        <div class="prompt" data-el="prompt" hidden></div>
        <div class="stick" data-el="stick" hidden><div class="knob" data-el="knob"></div></div>
        <button class="touch-interact" data-el="tInteract" data-act="interact" hidden></button>
      </div>
      <div class="fade" data-el="fade"></div>
      <div class="screen title" data-screen="title" hidden>
        <div class="title-card">
          <h1>${story.title.name}</h1>
          <p class="tagline">${t(story.title.tagline)}</p>
          <div class="intro" data-el="intro"></div>
          <div class="row">
            <button class="btn primary" data-act="continue" data-el="btnContinue">${story.title.continue}</button>
            <button class="btn" data-act="new">${story.title.newGame}</button>
          </div>
          <p class="warn" data-el="titleWarn" hidden></p>
        </div>
      </div>
      <div class="screen" data-screen="reader" hidden><div class="paper reader"><h2 data-el="readerTitle"></h2><div class="body" data-el="readerBody"></div><button class="btn primary" data-act="closeReader">${u.close}</button></div></div>
      <div class="screen" data-screen="map" hidden><div class="paper map-panel"><div class="map-wrap" data-el="mapWrap"></div><div class="map-side"><div data-el="legend"></div><button class="btn primary" data-act="close">${u.close}</button></div></div></div>
      <div class="screen" data-screen="journal" hidden><div class="paper list-panel"><h2>${u.journal}</h2><div class="body" data-el="journalBody"></div><button class="btn primary" data-act="back">${u.close}</button></div></div>
      <div class="screen" data-screen="achievements" hidden><div class="paper list-panel"><h2>${u.achievements}</h2><div class="body" data-el="achBody"></div><button class="btn primary" data-act="back">${u.close}</button></div></div>
      <div class="screen" data-screen="pause" hidden><div class="paper menu">
        <h2>${u.pause}</h2>
        <button class="btn primary" data-act="close">${u.resume}</button>
        <button class="btn" data-act="open-map">${u.map}</button>
        <button class="btn" data-act="open-journal">${u.journal}</button>
        <button class="btn" data-act="open-achievements">${u.achievements}</button>
        <button class="btn" data-act="open-settings">${u.settings}</button>
        <button class="btn" data-act="credits">${u.credits}</button>
        <button class="btn danger" data-act="reset">${u.reset}</button>
      </div></div>
      <div class="screen" data-screen="settings" hidden><div class="paper list-panel"><h2>${u.settings}</h2><div class="body settings" data-el="settingsBody"></div><button class="btn primary" data-act="back">${u.close}</button></div></div>
      <div class="screen" data-screen="error" hidden><div class="paper reader"><h2>${story.title.name}</h2><div class="body" data-el="errorBody"></div><button class="btn" data-act="retry" data-el="btnRetry">Reload</button></div></div>
      <div class="rotate"><p>${u.rotate}</p></div>`;
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((e) => (this.el[e.dataset.el!] = e));
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b) this.act(b.dataset.act!, b);
    });
    this.root.addEventListener('change', (e) => this.settingInput(e.target as HTMLInputElement));
    this.root.addEventListener('input', (e) => this.settingInput(e.target as HTMLInputElement));
    input.onStickChange = () => this.drawStick();
  }

  // ---- screens --------------------------------------------------------------
  private show(screen: Screen | null) {
    this.modal = screen;
    this.root.querySelectorAll<HTMLElement>('[data-screen]').forEach((s) => (s.hidden = s.dataset.screen !== screen));
    this.input.enabled = screen === null;
    if (screen) {
      this.input.releasePointer();
      this.root.querySelector<HTMLElement>(`[data-screen="${screen}"] .btn.primary, [data-screen="${screen}"] .btn`)?.focus();
    }
  }
  close() {
    this.show(null);
  }

  showTitle(warning?: string) {
    this.el.intro.innerHTML = rich(t(story.title.intro));
    this.el.btnContinue.hidden = !this.host.hasSave;
    this.el.titleWarn.hidden = !warning;
    if (warning) this.el.titleWarn.textContent = warning;
    this.show('title');
  }
  showError(message: string, retry = true) {
    this.el.errorBody.innerHTML = rich(message);
    this.el.btnRetry.hidden = !retry;
    this.show('error');
  }
  hudVisible(v: boolean) {
    this.el.hud.hidden = !v;
  }
  fade(on: boolean) {
    this.el.fade.classList.toggle('on', on);
  }

  /** Queue a story text. `done` runs after the player closes it. */
  read(id: string, done?: () => void) {
    this.readerQueue.push({ id, done });
    if (this.modal !== 'reader') this.nextReader();
  }
  private nextReader() {
    const next = this.readerQueue.shift();
    if (!next) return;
    const tx = text(next.id);
    this.el.readerTitle.textContent = tx.title;
    this.el.readerTitle.hidden = !tx.title;
    this.el.readerBody.innerHTML = rich(tx.body);
    this.el.readerBody.scrollTop = 0;
    this.readerDone = next.done;
    this.show('reader');
  }
  private closeReader() {
    const done = this.readerDone;
    this.readerDone = undefined;
    if (this.readerQueue.length) {
      done?.();
      return this.nextReader();
    }
    const back = this.readerReturn;
    this.readerReturn = null;
    if (back) this.open(back);
    else this.show(null);
    done?.();
  }

  open(screen: 'map' | 'journal' | 'achievements' | 'settings' | 'pause') {
    const s = this.host.state;
    if (screen === 'map') {
      this.el.mapWrap.innerHTML = renderMap(s, this.host.playerMarker());
      this.el.legend.innerHTML = legendHtml(s);
    } else if (screen === 'journal') {
      const hints = this.host.hints();
      const marks = s.symbols.map((g) => `<li class="mark">${glyphSvg(g, 40)}<span>${GLYPH_NAMES[g]}</span></li>`).join('');
      const pages = s.read.map((id) => `<li><button class="link" data-act="reread" data-id="${id}">${esc(text(id).title || id)}</button></li>`).join('');
      this.el.journalBody.innerHTML =
        (hints.length ? `<h3>Notes to self</h3><ul class="hints">${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '') +
        `<h3>Marks copied</h3>${marks ? `<ul class="marks">${marks}</ul>` : '<p class="muted">None yet.</p>'}` +
        `<h3>Pages</h3>${pages ? `<ul class="pages">${pages}</ul>` : '<p class="muted">Nothing read yet.</p>'}`;
    } else if (screen === 'achievements') {
      this.el.achBody.innerHTML = `<ul class="ach-list">${Object.entries(story.achievements)
        .map(([id, a]) => {
          const got = s.achievements.includes(id);
          const secret = a.hidden && !got;
          return `<li class="${got ? 'got' : ''}"><span class="badge">${got ? '◆' : '◇'}</span><div><b>${secret ? story.ui.hiddenAch : a.title}</b><p>${secret ? '???' : a.desc}</p></div></li>`;
        })
        .join('')}</ul>`;
    } else if (screen === 'settings') {
      this.renderSettings();
    }
    this.show(screen);
  }

  private renderSettings() {
    const st = this.host.state.settings;
    const chk = (k: string, label: string, v: boolean) => `<label class="set"><span>${label}</span><input type="checkbox" data-set="${k}" ${v ? 'checked' : ''}></label>`;
    const rng = (k: string, label: string, v: number, min: number, max: number) =>
      `<label class="set"><span>${label}</span><input type="range" data-set="${k}" min="${min}" max="${max}" step="0.05" value="${v}"></label>`;
    const keys = (Object.keys(KEY_LABEL) as Action[])
      .map((a) => `<label class="set"><span>${KEY_LABEL[a]}</span><button class="btn small" data-act="rebind" data-key="${a}">${keyName(st.keys[a])}</button></label>`)
      .join('');
    this.el.settingsBody.innerHTML =
      rng('volume', 'Volume', st.volume, 0, 1) +
      rng('sensitivity', 'Camera sensitivity', st.sensitivity, 0.3, 2.5) +
      chk('invertY', 'Invert camera Y', st.invertY) +
      chk('captions', 'Captions for sounds', st.captions) +
      chk('reducedMotion', 'Reduced motion', st.reducedMotion) +
      `<label class="set"><span>Graphics quality</span><select data-set="quality">${['auto', 'high', 'low'].map((q) => `<option value="${q}" ${st.quality === q ? 'selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select></label>` +
      `<p class="muted">Changing quality reloads the game. Progress is kept.</p>` +
      `<h3 class="keys-h">Keyboard</h3><div class="keys">${keys}</div>`;
  }

  private settingInput(inp: HTMLInputElement | HTMLSelectElement) {
    const key = inp?.dataset?.set;
    if (!key) return;
    const st = this.host.state.settings as unknown as Record<string, unknown>;
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') st[key] = inp.checked;
    else if (inp instanceof HTMLInputElement && inp.type === 'range') st[key] = Number(inp.value);
    else st[key] = inp.value;
    this.host.settingsChanged(key === 'quality');
  }

  private act(act: string, el: HTMLElement) {
    switch (act) {
      case 'continue': this.host.begin(false); break;
      case 'new': this.host.begin(true); break;
      case 'closeReader': this.closeReader(); break;
      case 'close': this.show(null); break;
      case 'back': this.open('pause'); break;
      case 'map': this.input.onTrigger('map'); break;
      case 'pause': this.input.onTrigger('pause'); break;
      case 'interact': this.input.onTrigger('interact'); break;
      case 'open-map': this.open('map'); break;
      case 'open-journal': this.open('journal'); break;
      case 'open-achievements': this.open('achievements'); break;
      case 'open-settings': this.open('settings'); break;
      case 'credits': this.readerReturn = 'pause'; this.read('credits'); break;
      case 'reread': this.readerReturn = 'journal'; this.read(el.dataset.id!); break;
      case 'reset': if (window.confirm(story.ui.resetConfirm)) this.host.resetProgress(); break;
      case 'retry': location.reload(); break;
      case 'rebind': {
        el.textContent = 'Press a key…';
        this.input.captureNextKey((code) => {
          this.host.state.settings.keys[el.dataset.key as Action] = code;
          this.host.settingsChanged();
          this.renderSettings();
        });
        break;
      }
    }
  }

  // ---- HUD ------------------------------------------------------------------
  setZone(name: string) {
    this.el.zone.textContent = name;
    this.el.zone.classList.remove('flash');
    void this.el.zone.offsetWidth;
    this.el.zone.classList.add('flash');
    this.zoneTimer = 4;
  }
  setObjective(s: string) {
    if (this.el.objective.textContent !== s) this.el.objective.textContent = s;
  }
  setExplored() {
    this.el.pct.textContent = `${Math.round(exploredFraction(this.host.state) * 100)}%`;
  }
  setPrompt(label: string | null) {
    const key = keyName(this.host.state.settings.keys.interact);
    this.el.prompt.hidden = !label || this.input.isTouch;
    this.el.tInteract.hidden = !label || !this.input.isTouch;
    if (label) {
      this.el.prompt.innerHTML = `<kbd>${key}</kbd> ${esc(label)}`;
      this.el.tInteract.textContent = label;
    }
  }
  setTip(s: string | null) {
    this.el.tip.hidden = !s;
    if (s) this.el.tip.textContent = s;
  }
  caption(s: string) {
    if (!this.host.state.settings.captions) return;
    this.el.caption.textContent = `[ ${s} ]`;
    this.el.caption.hidden = false;
    this.captionTimer = 3.5;
  }
  /** direction to a sound, relative to where the camera faces (radians, + = right); null hides it */
  soundDirection(angle: number | null, label = '', pulse = false) {
    this.el.soundDir.hidden = angle === null || !this.host.state.settings.captions;
    if (angle === null) return;
    this.el.soundArrow.style.transform = `rotate(${(angle * 180) / Math.PI - 90}deg)`;
    this.el.soundText.textContent = label;
    if (pulse) {
      this.el.soundDir.classList.remove('pulse');
      void this.el.soundDir.offsetWidth;
      this.el.soundDir.classList.add('pulse');
    }
  }
  toast(kind: 'ach' | 'map' | 'note', title: string, sub = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), 4200);
    setTimeout(() => d.remove(), 4800);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild!.remove();
  }
  private drawStick() {
    const s = this.input.stick;
    this.el.stick.hidden = !s.active;
    if (!s.active) return;
    this.el.stick.style.left = `${s.ox}px`;
    this.el.stick.style.top = `${s.oy}px`;
    this.el.knob.style.transform = `translate(${s.x * 56}px, ${-s.y * 56}px)`;
  }
  update(dt: number) {
    if (this.captionTimer > 0 && (this.captionTimer -= dt) <= 0) this.el.caption.hidden = true;
    if (this.zoneTimer > 0) this.zoneTimer -= dt;
    this.toastTimer += dt;
  }
}
