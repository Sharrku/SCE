const MID = "sce";
const SOCKET = `module.${MID}`;
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ATMOSPHERES = {
  embers: "Ashes & Embers", smoke: "Smoke", storm: "Lightning Storm",
  frost: "Frozen Omen", radiance: "Celestial Radiance", abyss: "Abyssal Vortex", none: "None"
};
const DEFEATS = {
  ashes: "Ashes", implode: "Implode", shatter: "Shatter", banish: "Banish",
  petrify: "Petrify and Crumble", nova: "Nova", eclipse: "Eclipse"
};

const blank = () => ({
  id: foundry.utils.randomID(), name: "New Boss", subtitle: "", image: "", narration: "",
  atmosphere: "embers", color: "#c01818", duration: 14, stinger: "", stingerFadeIn: 0, revealSound: "", crossStart: -0.8, crossLen: 2.4, revealHold: 6, afterReveal: "auto", music: "", victoryMusic: "",
  bossActorId: "", sceneId: "", theatreScene: false, sceneBackground: "", sceneWeather: "", barName: "", startCombat: true, showBar: true,
  phases: "", defeat: "ashes", victoryTitle: "Victory", victoryText: ""
});

/** Intro timeline in ms. "duration" (s) is the minimum total length. */
function introTimes(enc) {
  const n = lines(enc.narration).length;
  const slot = 3600, narrStart = 2200;
  const art = narrStart + n * slot + (n ? 400 : 0);
  const title = art + 2200;
  const hold = Math.max(0, Number(enc.revealHold ?? 6)) * 1000;
  const askAt = title + hold;
  // "auto" ends by itself; "ask" and "hold" wait for the GM
  const end = (enc.afterReveal || "auto") === "auto" ? Math.max(askAt, (enc.duration || 0) * 1000) : null;
  return { slot, narrStart, art, title, askAt, end };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const lines = s => String(s ?? "").split("\n").map(l => l.trim()).filter(Boolean);

function parsePhases(text) {
  return lines(text).map(l => {
    const [pct, line, sound] = l.split("|").map(x => x?.trim());
    return { pct: Number(pct), line: line ?? "", sound: sound ?? "" };
  }).filter(p => Number.isFinite(p.pct) && p.pct > 0 && p.pct < 100).sort((a, b) => b.pct - a.pct);
}

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */
const getAll = () => game.settings.get(MID, "encounters") ?? [];
const saveAll = list => game.settings.set(MID, "encounters", list);
const getEnc = id => getAll().find(e => e.id === id);

/* ------------------------------------------------------------------ */
/* Client-side presentation                                           */
/* ------------------------------------------------------------------ */
const UI = {
  root: null, loops: [], musicHandle: null, revealHandle: null, timers: [], skip: null, release: null, choice: "combat",

  ensureRoot() {
    if (!this.root?.isConnected) {
      this.root = document.createElement("div");
      this.root.id = "ee-root";
      document.body.appendChild(this.root);
    }
    return this.root;
  },

  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); },

  async sound(src, { loop = false, volume = 0.8 } = {}) {
    if (!src) return null;
    try {
      return await foundry.audio.AudioHelper.play({ src, volume, loop, autoplay: true }, false);
    } catch (e) { console.warn(`${MID} | audio failed`, src, e); return null; }
  },

  fadeTo(h, vol, ms) { try { h?.fade?.(vol, { duration: ms }); } catch (e) { /* ignore */ } },
  fadeOut(h, ms) {
    if (!h) return;
    this.fadeTo(h, 0, ms);
    setTimeout(() => { try { h.stop(); } catch (e) { /* ignore */ } }, ms + 100);
  },

  async setMusic(src) {
    this.stopMusic();
    this.musicHandle = await this.sound(src, { loop: true, volume: 0.6 });
  },
  stopMusic() {
    try { this.musicHandle?.stop?.(); } catch (e) { /* ignore */ }
    this.musicHandle = null;
  },

  clearOverlay(sel) { this.ensureRoot().querySelectorAll(sel).forEach(n => n.remove()); },

  shake() {
    document.body.classList.add("ee-shake");
    setTimeout(() => document.body.classList.remove("ee-shake"), 900);
  },

  /* ---------- atmosphere canvas ---------- */
  atmosphere(canvas, kind, color) {
    if (kind === "none") return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width = window.innerWidth, H = canvas.height = window.innerHeight;
    const n = { embers: 90, smoke: 22, storm: 160, frost: 120, radiance: 50, abyss: 70 }[kind] ?? 60;
    const P = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: Math.random() * 3 + 1,
      vx: (Math.random() - .5) * .6, vy: Math.random() + .3, a: Math.random(), s: Math.random() * 120 + 60
    }));
    let flash = 0, ang = 0, stopped = false;
    const frame = () => {
      if (stopped || !canvas.isConnected) return;
      ctx.clearRect(0, 0, W, H);
      for (const p of P) {
        if (kind === "embers") {
          p.y -= p.vy * 1.4; p.x += Math.sin(p.y / 40) * .6 + p.vx;
          if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
          ctx.fillStyle = `rgba(255,${120 + p.a * 90 | 0},40,${.4 + p.a * .5})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        } else if (kind === "smoke") {
          p.x += p.vx * .5 + .2; p.y -= p.vy * .15;
          if (p.x > W + p.s) p.x = -p.s; if (p.y < -p.s) p.y = H + p.s;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 3);
          g.addColorStop(0, "rgba(200,200,200,.07)"); g.addColorStop(1, "rgba(200,200,200,0)");
          ctx.fillStyle = g; ctx.fillRect(p.x - p.s * 3, p.y - p.s * 3, p.s * 6, p.s * 6);
        } else if (kind === "storm") {
          p.y += p.vy * 14; p.x -= 3;
          if (p.y > H) { p.y = -20; p.x = Math.random() * W + 100; }
          ctx.strokeStyle = "rgba(180,200,255,.35)"; ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 3, p.y - 16); ctx.stroke();
        } else if (kind === "frost") {
          p.y += p.vy * .8; p.x += Math.sin(p.y / 30) * .5;
          if (p.y > H) { p.y = -5; p.x = Math.random() * W; }
          ctx.fillStyle = `rgba(210,235,255,${.4 + p.a * .5})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        } else if (kind === "radiance") {
          p.y -= p.vy * .5; if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
          ctx.fillStyle = `rgba(255,240,170,${.2 + .5 * Math.abs(Math.sin(p.a * 9 + performance.now() / 700))})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 1, 0, 7); ctx.fill();
        } else if (kind === "abyss") {
          const dx = p.x - W / 2, dy = p.y - H / 2, d = Math.hypot(dx, dy) || 1;
          p.x += (-dy / d) * 2 - dx * .004; p.y += (dx / d) * 2 - dy * .004;
          if (d < 30) { p.x = Math.random() * W; p.y = Math.random() * H; }
          ctx.fillStyle = `${color}99`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        }
      }
      if (kind === "storm") {
        if (Math.random() < .008) flash = 1;
        if (flash > 0) { ctx.fillStyle = `rgba(220,230,255,${flash * .45})`; ctx.fillRect(0, 0, W, H); flash -= .06; }
      }
      requestAnimationFrame(frame);
    };
    frame();
    return () => { stopped = true; };
  },

  /* ---------- intro ---------- */
  async intro(enc, preview = false) {
    this.clearOverlay(".ee-intro");
    const el = document.createElement("div");
    el.className = "ee-intro";
    el.style.setProperty("--ee-accent", enc.color || "#c01818");
    el.innerHTML = `
      <div class="ee-dim"></div>
      <canvas class="ee-fx"></canvas>
      <div class="ee-vignette"></div>
      <div class="ee-bar top"></div><div class="ee-bar bottom"></div>
      ${enc.image ? `<img class="ee-boss" src="${esc(enc.image)}">` : ""}
      <div class="ee-text">
        <div class="ee-sub">${esc(enc.subtitle)}</div>
        <h1 class="ee-name">${esc(enc.name)}</h1>
        <div class="ee-narr"></div>
      </div>`;
    this.ensureRoot().appendChild(el);
    const stopFx = this.atmosphere(el.querySelector("canvas"), enc.atmosphere, enc.color);
    const mode = enc.afterReveal || "auto";
    const fadeIn = Math.max(0, Number(enc.stingerFadeIn || 0)) * 1000;
    const stingerP = this.sound(enc.stinger, { volume: fadeIn ? 0 : 0.9 });
    if (fadeIn) stingerP.then(h => this.fadeTo(h, 0.9, fadeIn));
    this.revealHandle = null;
    this.choice = "combat";

    let done;
    const finished = new Promise(r => done = r);
    this.release = done;
    const end = () => {
      if (!el.isConnected || el.classList.contains("out")) return;
      stopFx?.(); el.classList.add("out");
      // Theatre scene: switch under the fading overlay so nobody sees the old map
      if (game.user.isGM && enc.theatreScene && !preview) activateTheatre(enc);
      stingerP.then(h => this.fadeOut(h, 1200));
      this.fadeOut(this.revealHandle, 1200); this.revealHandle = null;
      setTimeout(() => { el.remove(); done(); }, 1200);
    };
    this.skip = end;
    const sendEnd = choice => {
      this.choice = choice;
      game.socket.emit(SOCKET, { action: "introEnd", data: {} });
      end();
    };
    if (game.user.isGM) el.addEventListener("click", ev => {
      if (!ev.target.closest(".ee-gm") && mode === "auto") sendEnd("combat");
    });

    const gmPanel = html => {
      if (!game.user.isGM) return null;
      el.querySelector(".ee-gm")?.remove();
      const p = document.createElement("div");
      p.className = "ee-gm"; p.innerHTML = html;
      el.appendChild(p);
      return p;
    };
    const showClose = () => {
      const p = gmPanel(`<span>Screen is held (theatre of the mind)</span><button type="button" data-a="close">Close screen</button>`);
      p?.querySelector("[data-a=close]").addEventListener("click", () => sendEnd("none"));
    };
    const showAsk = () => {
      const p = gmPanel(`<span>What now?</span>
        <button type="button" data-a="go">Continue to combat</button>
        <button type="button" data-a="stay">Stay on this screen</button>`);
      p?.querySelector("[data-a=go]").addEventListener("click", () => sendEnd("combat"));
      p?.querySelector("[data-a=stay]").addEventListener("click", showClose);
    };

    requestAnimationFrame(() => el.classList.add("in"));
    // 1) scene dims, 2) narration lines, 3) artwork (stinger crossfades into the reveal sound), 4) title
    const t = introTimes(enc);
    const box = el.querySelector(".ee-narr");
    lines(enc.narration).forEach((txt, i) => this.later(() => {
      box.innerHTML = `<span style="animation-duration:${t.slot}ms">${esc(txt)}</span>`;
    }, t.narrStart + i * t.slot));
    if (enc.revealSound) {
      // Crossfade: starts crossStart seconds relative to the artwork (negative = before), lasts crossLen seconds
      const len = Math.max(0.2, Number(enc.crossLen ?? 2.4)) * 1000;
      const at = Math.max(0, t.art + Number(enc.crossStart ?? -0.8) * 1000);
      this.later(async () => {
        stingerP.then(h => this.fadeOut(h, len));
        this.revealHandle = await this.sound(enc.revealSound, { volume: 0, loop: false });
        this.fadeTo(this.revealHandle, 0.9, len);
      }, at);
    }
    this.later(() => el.classList.add("reveal"), t.art);
    this.later(() => el.classList.add("title"), t.title);
    if (mode === "hold") this.later(showClose, t.title);
    else if (mode === "ask") this.later(showAsk, t.askAt);
    else this.later(() => sendEnd("combat"), t.end);
    await finished;
    return this.choice;
  },

  /* ---------- boss bar ---------- */
  bar(d) {
    let b = this.ensureRoot().querySelector(".ee-bossbar");
    if (d.hide) { b?.classList.add("out"); setTimeout(() => b?.remove(), 800); return; }
    if (!b) {
      b = document.createElement("div");
      b.className = "ee-bossbar";
      b.innerHTML = `<div class="ee-bb-name"></div><div class="ee-bb-track">
        <div class="ee-bb-ghost"></div><div class="ee-bb-fill"></div><div class="ee-bb-marks"></div></div>
        <div class="ee-bb-pct"></div>`;
      this.root.appendChild(b);
      requestAnimationFrame(() => b.classList.add("in"));
    }
    b.style.setProperty("--ee-accent", d.color || "#c01818");
    b.querySelector(".ee-bb-name").textContent = d.name ?? "";
    b.querySelector(".ee-bb-fill").style.width = `${d.pct}%`;
    b.querySelector(".ee-bb-ghost").style.width = `${d.pct}%`;
    b.querySelector(".ee-bb-pct").textContent = `${Math.ceil(d.pct)}%`;
    b.querySelector(".ee-bb-marks").innerHTML = (d.marks ?? []).map(m => `<i style="left:${m}%"></i>`).join("");
  },

  phase(d) {
    this.shake();
    this.sound(d.sound, { volume: 0.9 });
    const el = document.createElement("div");
    el.className = "ee-phase";
    el.innerHTML = `<span>${esc(d.line)}</span>`;
    this.ensureRoot().appendChild(el);
    setTimeout(() => el.remove(), 4200);
  },

  /* ---------- defeat + victory ---------- */
  async defeat(d) {
    this.stopMusic();
    this.bar({ hide: true });
    const el = document.createElement("div");
    el.className = `ee-defeat ee-def-${d.effect}`;
    el.innerHTML = `<div class="ee-flash"></div><div class="ee-disc"></div>
      ${d.image ? `<img src="${esc(d.image)}">` : ""}`;
    this.ensureRoot().appendChild(el);
    this.shake();
    if (d.effect === "ashes" || d.effect === "petrify") {
      const c = document.createElement("canvas"); c.className = "ee-fx"; el.appendChild(c);
      const stop = this.atmosphere(c, "embers", "#ff7a2a"); setTimeout(() => stop?.(), 4500);
    }
    await sleep(4200);
    el.classList.add("out"); await sleep(900); el.remove();
  },

  async victory(d) {
    this.sound(d.music, { loop: false, volume: 0.8 });
    const el = document.createElement("div");
    el.className = "ee-victory";
    el.style.setProperty("--ee-accent", d.color || "#c8a24a");
    el.innerHTML = `<div class="ee-v-inner"><div class="ee-v-line"></div>
      <h1>${esc(d.title || "Victory")}</h1><div class="ee-v-line"></div>
      <p>${esc(d.text).replace(/\n/g, "<br>")}</p></div>`;
    this.ensureRoot().appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    const close = () => { el.classList.remove("in"); setTimeout(() => el.remove(), 1000); };
    if (game.user.isGM) el.addEventListener("click", () => { close(); });
    setTimeout(close, 15000);
  },

  stop() {
    this.timers.forEach(clearTimeout); this.timers = [];
    this.stopMusic();
    try { this.revealHandle?.stop(); } catch (e) { /* ignore */ }
    this.revealHandle = null;
    this.choice = "none"; this.release?.(); this.release = null;
    this.ensureRoot().innerHTML = "";
  }
};

/* ------------------------------------------------------------------ */
/* GM-side orchestration                                              */
/* ------------------------------------------------------------------ */
const emit = (action, data = {}) => {
  game.socket.emit(SOCKET, { action, data });
  return handle({ action, data });
};

async function handle({ action, data }) {
  switch (action) {
    case "intro": return await UI.intro(data.enc, !!data.preview);
    case "introEnd": UI.skip?.(); break;
    case "music": UI.setMusic(data.src); break;
    case "bar": UI.bar(data); break;
    case "phase": UI.phase(data); break;
    case "defeat": await UI.defeat(data); break;
    case "victory": await UI.victory(data); break;
    case "stop": UI.stop(); break;
  }
}

const Active = {
  get state() { return game.settings.get(MID, "active"); },
  set: s => game.settings.set(MID, "active", s)
};

async function runIntro(enc) { emit("intro", { enc, preview: true }); }

async function startEncounter(id) {
  const enc = getEnc(id);
  if (!enc) return;
  if (enc.theatreScene) {
    if (!await ensureTheatreScene(enc)) return;
  } else if (enc.sceneId && canvas.scene?.id !== enc.sceneId) {
    await game.scenes.get(enc.sceneId)?.view();
  }
  await Active.set({ id: enc.id, fired: [], over: false });
  // Resolves when the intro ends (timer, or the GM decides); "none" = GM kept the screen, no combat
  const choice = await emit("intro", { enc });
  if (Active.state?.id !== enc.id || choice === "none") return;
  if (enc.music) emit("music", { src: enc.music });
  if (enc.startCombat) await setupCombat(enc);
  if (enc.showBar && enc.bossActorId) pushBar(enc);
}

/** Creates (or refreshes) the scene built from the encounter artwork or video background. */
async function ensureTheatreScene(enc) {
  const src = enc.sceneBackground || enc.image;
  if (!src) { ui.notifications.warn("SCE: Set artwork or a scene background first."); return null; }
  const weather = CONFIG.weatherEffects?.[enc.sceneWeather] ? enc.sceneWeather : "";
  let scene = game.scenes.find(s => s.getFlag(MID, "encounterId") === enc.id);
  // v14 moved the background (src and color) from the Scene to its Level
  const levels = !!foundry.documents?.BaseScene?._LEVELS_PROPERTY_MAP;
  if (scene) {
    const level = levels ? scene.firstLevel : null;
    const cur = levels ? level?.background?.src : scene.background?.src;
    if (levels && level && (cur !== src || level.background?.color?.toString().toLowerCase() !== "#000000")) {
      await scene.updateEmbeddedDocuments("Level", [{ _id: level.id, "background.src": src, "background.color": "#000000" }]);
    } else if (!levels && cur !== src) {
      await scene.update({ "background.src": src, backgroundColor: "#000000" });
    }
    if ((scene.weather ?? "") !== weather) await scene.update({ weather });
    return scene;
  }
  let width = 1920, height = 1080;
  try {
    const tex = await foundry.canvas.loadTexture(src);
    if (tex?.width && tex?.height) { width = tex.width; height = tex.height; }
  } catch (e) { console.warn(`${MID} | could not read background size`, e); }
  const data = {
    name: `SCE: ${enc.name}`, width, height, padding: 0, navigation: false,
    ...(levels ? { levels: [{ name: "Main", background: { src, color: "#000000" } }] }
               : { background: { src }, backgroundColor: "#000000" }),
    grid: { type: 0 }, tokenVision: false,
    fog: { exploration: false }, environment: { globalLight: { enabled: true } },
    flags: { [MID]: { encounterId: enc.id } }
  };
  try { return await Scene.create({ ...data, weather }); }
  catch (e) { console.warn(`${MID} | scene with weather failed, retrying without`, e); return Scene.create(data); }
}

async function activateTheatre(enc) {
  const scene = game.scenes.find(s => s.getFlag(MID, "encounterId") === enc.id);
  if (scene) await scene.activate();
}

async function setupCombat(enc) {
  const scene = canvas.scene;
  if (!scene) return;
  let combat = game.combats.find(c => c.scene?.id === scene.id);
  if (!combat) combat = await Combat.create({ scene: scene.id, active: true });
  const have = new Set(combat.combatants.map(c => c.tokenId));
  const add = scene.tokens.filter(t => !t.hidden && !have.has(t.id))
    .map(t => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId }));
  if (add.length) await combat.createEmbeddedDocuments("Combatant", add);
  ui.combat?.render?.(true);
}

function hpOf(actor) {
  const hp = foundry.utils.getProperty(actor, game.settings.get(MID, "hpPath"));
  if (!hp || typeof hp !== "object") return null;
  return { value: hp.value ?? 0, max: hp.effectiveMax ?? hp.max ?? 1 };
}

function bossActors(enc) {
  return canvas.scene?.tokens.filter(t => t.actorId === enc.bossActorId).map(t => t.actor).filter(Boolean) ?? [];
}

function pushBar(enc, pct) {
  if (pct === undefined) {
    const a = bossActors(enc)[0] ?? game.actors.get(enc.bossActorId);
    const hp = a && hpOf(a);
    pct = hp ? hp.value / hp.max * 100 : 100;
  }
  emit("bar", { pct: Math.max(0, Math.min(100, pct)), name: enc.barName || enc.name,
    color: enc.color, marks: parsePhases(enc.phases).map(p => p.pct) });
}

async function onHpChange(actor) {
  if (!game.user.isGM) return;
  const st = Active.state;
  if (!st?.id || st.over) return;
  const enc = getEnc(st.id);
  if (!enc || !enc.bossActorId || actor.id !== enc.bossActorId) return;
  const hp = hpOf(actor); if (!hp) return;
  const pct = hp.value / hp.max * 100;
  pushBar(enc, pct);
  const fired = new Set(st.fired);
  for (const p of parsePhases(enc.phases)) {
    if (pct <= p.pct && !fired.has(p.pct)) {
      fired.add(p.pct);
      emit("phase", { line: p.line, sound: p.sound });
    }
  }
  if (hp.value <= 0) {
    await Active.set({ ...st, fired: [...fired], over: true });
    emit("defeat", { effect: enc.defeat, image: enc.image });
    await sleep(5200);
    emit("victory", { title: enc.victoryTitle, text: enc.victoryText, music: enc.victoryMusic, color: enc.color });
  } else if (fired.size !== st.fired.length) {
    await Active.set({ ...st, fired: [...fired] });
  }
}

/* ------------------------------------------------------------------ */
/* Applications                                                       */
/* ------------------------------------------------------------------ */
const ATMOS_ICONS = { embers: "fa-fire", smoke: "fa-cloud", storm: "fa-bolt", frost: "fa-snowflake", radiance: "fa-sun", abyss: "fa-circle-notch", none: "fa-ban" };
const DEFEAT_ICONS = { ashes: "fa-fire", implode: "fa-compress", shatter: "fa-burst", banish: "fa-wand-sparkles", petrify: "fa-mountain", nova: "fa-sun", eclipse: "fa-moon" };
const AFTER = [
  { value: "auto", label: "Continue automatically", icon: "fa-forward", short: "Auto", desc: "The reveal fades out by itself and the encounter starts." },
  { value: "ask", label: "Let me decide", icon: "fa-hand-pointer", short: "Ask", desc: "Buttons appear for you: continue to combat, or stay on the screen." },
  { value: "hold", label: "Hold the screen", icon: "fa-pause", short: "Hold", desc: "Theatre of the mind. Stays until you close it, no combat." }
];

class EncounterEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sce-editor", tag: "div", classes: ["sce-app"],
    window: { title: "Edit Encounter", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 660, height: 780 }
  };
  static PARTS = { form: { template: `modules/${MID}/templates/editor.hbs` } };

  tab = "story";

  constructor(enc, options = {}) { super(options); this.enc = enc; }

  async _prepareContext() {
    const e = this.enc;
    const actors = Object.fromEntries(game.actors.filter(a => a.type !== "character").map(a => [a.id, a.name]));
    const scenes = Object.fromEntries(game.scenes.map(s => [s.id, s.name]));
    const weathers = { "": "None", ...Object.fromEntries(Object.entries(CONFIG.weatherEffects ?? {}).map(([k, v]) => [k, game.i18n.localize(v.label)])) };
    const list = (map, icons, cur) => Object.entries(map).map(([value, label]) => ({ value, label, icon: icons[value], checked: value === cur }));
    return {
      e, actors, scenes, weathers,
      atmosphereList: list(ATMOSPHERES, ATMOS_ICONS, e.atmosphere),
      defeatList: list(DEFEATS, DEFEAT_ICONS, e.defeat),
      afterList: AFTER.map(a => ({ ...a, checked: a.value === (e.afterReveal || "auto") }))
    };
  }

  /** Reads the whole form into an encounter object. */
  _collect(form) {
    const fd = new foundry.applications.ux.FormDataExtended(form).object;
    const enc = foundry.utils.mergeObject(this.enc, fd, { inplace: false });
    enc.startCombat = !!fd.startCombat; enc.theatreScene = !!fd.theatreScene; enc.showBar = !!fd.showBar;
    enc.duration = Number(fd.duration) || 14;
    enc.revealHold = Number(fd.revealHold) || 0;
    enc.crossStart = Number(fd.crossStart) || 0;
    enc.crossLen = Number(fd.crossLen) || 2.4;
    enc.stingerFadeIn = Number(fd.stingerFadeIn) || 0;
    enc.phases = [...form.querySelectorAll(".sce-phase")].map(r => {
      const pct = Number(r.querySelector(".p-pct").value);
      if (!(pct > 0 && pct < 100)) return null;
      const line = r.querySelector(".p-line").value.replace(/\|/g, "/").trim();
      const sound = (r.querySelector("file-picker")?.value || "").trim();
      return `${pct} | ${line} | ${sound}`;
    }).filter(Boolean).join("\n");
    return enc;
  }

  _timeline(form) {
    const el = form.querySelector(".sce-timeline");
    if (!el) return;
    const enc = this._collect(form);
    const t = introTimes(enc);
    const total = t.end ?? (t.askAt + 3000);
    const p = ms => Math.max(0, Math.min(100, ms / total * 100));
    const xs = Math.max(0, t.art + enc.crossStart * 1000);
    const xe = xs + Math.max(200, enc.crossLen * 1000);
    const fade = enc.stingerFadeIn * 1000;
    const seg = (a, b, cls, label) => `<span class="seg ${cls}" style="left:${p(a)}%;width:${Math.max(0, p(b) - p(a))}%">${label}</span>`;
    el.innerHTML = `
      <div class="tl-track">
        ${seg(0, t.narrStart, "dim", "Dim")}${seg(t.narrStart, t.art, "narr", "Narration")}
        ${seg(t.art, t.title, "art", "Artwork")}${seg(t.title, total, "title", "Title")}
      </div>
      <div class="tl-row${enc.stinger ? "" : " off"}"><span class="lab">Stinger</span>
        <div class="bar stinger" style="left:0;width:${p(xe)}%"><i style="width:${Math.min(100, fade / Math.max(1, xe) * 100)}%"></i></div></div>
      <div class="tl-row${enc.revealSound ? "" : " off"}"><span class="lab">Reveal</span>
        <div class="bar reveal" style="left:${p(xs)}%;width:${100 - p(xs)}%"></div></div>
      <div class="tl-axis"><span>0 s</span><span>${(total / 1000).toFixed(0)} s</span></div>`;
  }

  _onRender() {
    const root = this.element, form = root.querySelector("form");

    // Tabs
    const show = tab => {
      this.tab = tab;
      root.querySelectorAll(".sce-tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
      root.querySelectorAll(".sce-pane").forEach(p => p.classList.toggle("active", p.dataset.tab === tab));
    };
    root.querySelectorAll(".sce-tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.tab)));
    show(this.tab);

    // Phases
    const list = form.querySelector(".sce-phases");
    const addRow = (p = { pct: 50, line: "", sound: "" }) => {
      const row = document.createElement("div");
      row.className = "sce-phase";
      row.innerHTML = `
        <div class="pct"><input type="number" class="p-pct" min="1" max="99" value="${p.pct}"><span>%</span></div>
        <div class="body">
          <input type="text" class="p-line" placeholder="Line shown on screen" value="${esc(p.line)}">
          <file-picker type="audio" value="${esc(p.sound)}"></file-picker>
        </div>
        <button type="button" class="sce-rm" title="Remove phase"><i class="fa-solid fa-xmark"></i></button>`;
      list.appendChild(row);
    };
    parsePhases(this.enc.phases).forEach(addRow);
    form.querySelector(".sce-add-phase").addEventListener("click", () => addRow());
    list.addEventListener("click", ev => ev.target.closest(".sce-rm")?.closest(".sce-phase").remove());

    // Live bits: accent color, hero artwork, sound timeline
    const refresh = ev => {
      const t = ev?.target;
      if (t?.name === "color") form.style.setProperty("--accent", t.value);
      if (t?.name === "image") {
        const art = form.querySelector(".sce-hero-art");
        art.style.backgroundImage = t.value ? `url('${t.value}')` : "";
        art.innerHTML = t.value ? "" : '<i class="fa-solid fa-dragon"></i>';
      }
      this._timeline(form);
    };
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    this._timeline(form);

    // Footer
    form.querySelector("[data-act=cancel]").addEventListener("click", () => this.close());
    form.querySelector("[data-act=preview]").addEventListener("click", () => UI.intro(this._collect(form), true));
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const enc = this._collect(form);
      const all = getAll(); const i = all.findIndex(x => x.id === enc.id);
      if (i >= 0) all[i] = enc; else all.push(enc);
      await saveAll(all);
      Manager.instance?.render();
      this.close();
    });
  }
}

class Manager extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;
  static DEFAULT_OPTIONS = {
    id: "sce-manager", classes: ["sce-app"],
    window: { title: "SCE - Encounters", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 780, height: 620 },
    actions: {
      create() { new EncounterEditor(blank()).render(true); },
      stop() { Active.set(null); emit("stop"); this.render(); },
      intro(ev, t) { runIntro(getEnc(t.dataset.id)); },
      async start(ev, t) { const p = startEncounter(t.dataset.id); this.render(); await p; this.render(); },
      edit(ev, t) { new EncounterEditor(foundry.utils.deepClone(getEnc(t.dataset.id))).render(true); },
      async duplicate(ev, t) {
        const c = foundry.utils.deepClone(getEnc(t.dataset.id));
        c.id = foundry.utils.randomID(); c.name += " (Copy)";
        await saveAll([...getAll(), c]); this.render();
      },
      async delete(ev, t) {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete encounter" }, content: "<p>Delete this encounter?</p>" });
        if (ok) { await saveAll(getAll().filter(e => e.id !== t.dataset.id)); this.render(); }
      }
    }
  };
  static PARTS = { main: { template: `modules/${MID}/templates/manager.hbs` } };

  constructor(...a) { super(...a); Manager.instance = this; }

  async _prepareContext() {
    const act = Active.state?.id;
    const encounters = getAll().map(e => {
      const after = AFTER.find(a => a.value === (e.afterReveal || "auto")) ?? AFTER[0];
      const chips = [{ icon: after.icon, label: after.short }];
      if (e.theatreScene) chips.push({ icon: "fa-image", label: "Scene" });
      if (e.showBar && e.bossActorId) chips.push({ icon: "fa-heart", label: "Boss bar" });
      const n = parsePhases(e.phases).length;
      if (n) chips.push({ icon: "fa-heart-crack", label: `${n} phase${n > 1 ? "s" : ""}` });
      return { ...e, chips, active: e.id === act };
    });
    return { encounters, running: encounters.find(e => e.active)?.name ?? "" };
  }
}

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
Hooks.once("init", () => {
  game.settings.register(MID, "encounters", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MID, "examplesImported", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MID, "active", { scope: "world", config: false, type: Object, default: null });
  game.settings.register(MID, "hpPath", {
    name: "HP data path", hint: "Path on the actor to the HP object with value and max (D&D 5e default).",
    scope: "world", config: true, type: String, default: "system.attributes.hp"
  });
  // Keybindings must be registered during "init"
  game.keybindings.register(MID, "open", {
    name: "Open SCE",
    editable: [{ key: "KeyE", modifiers: ["Alt"] }],
    restricted: true,
    onDown: () => { game.modules.get(MID).api?.open(); return true; }
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, handle);
  if (game.user.isGM && !game.settings.get(MID, "examplesImported")) importExample();
  const api = {
    open: () => new Manager().render(true),
    start: startEncounter, intro: id => runIntro(getEnc(id)), stop: () => { Active.set(null); emit("stop"); },
    get: getEnc, list: getAll,
    save: async enc => {
      const all = getAll(); const i = all.findIndex(e => e.id === enc.id);
      if (i >= 0) all[i] = enc; else all.push(enc);
      await saveAll(all); Manager.instance?.render();
    },
    blank
  };
  game.modules.get(MID).api = api;
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const tokens = controls.tokens ?? controls.token;
  if (!tokens) return;
  tokens.tools[`${MID}-open`] = {
    name: `${MID}-open`, title: "SCE", icon: "fa-solid fa-dragon",
    order: 99, button: true, onChange: () => game.modules.get(MID).api.open()
  };
});

Hooks.on("updateActor", (actor, change) => {
  if (foundry.utils.hasProperty(change, "system.attributes.hp")) onHpChange(actor);
});
Hooks.on("updateToken", (token, change) => {
  if (token.actor && change.delta) onHpChange(token.actor);
});
Hooks.on("deleteCombat", async () => {
  if (!game.user.isGM) return;
  const st = Active.state;
  if (st?.id && !st.over) { await Active.set(null); emit("bar", { hide: true }); UI.stopMusic(); emit("stop"); }
});

/** Adds the bundled example encounter once per world (set your own artwork and boss actor in the editor). */
async function importExample() {
  try {
    const ex = await fetch(`modules/${MID}/examples/example-encounter.json`).then(r => r.json());
    ex.id = foundry.utils.randomID();
    ex.name = `${ex.name} (Example)`;
    await saveAll([...getAll(), ex]);
    await game.settings.set(MID, "examplesImported", true);
  } catch (e) { console.warn(`${MID} | could not import example`, e); }
}