// Small enhancements; the site reads fine without any of this.
//  1. Relative dates ("4 days ago") revealed on hover.
//  2. The dial: a graduated rail that turns as you move from one post to the next,
//     with a soft mechanical click per detent.
//  3. Article dates that roll into place like a dial on load.

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- rolling link labels ----------
   Each letter is a tiny two-row reel. On hover the reels turn one notch,
   left to right, so the word rolls over like the dial. Screen readers get
   the plain word from a visually hidden copy. */

const Roll = (() => {
  const build = (el, top, bottom = top) => {
    el.textContent = "";
    el.append(Object.assign(document.createElement("span"), { className: "visually-hidden", textContent: bottom }));
    const word = document.createElement("span");
    word.className = "roll";
    word.setAttribute("aria-hidden", "true");
    const n = Math.max(top.length, bottom.length);
    for (let i = 0; i < n; i++) {
      const ch = document.createElement("span");
      ch.className = "ch";
      ch.style.setProperty("--i", i);
      const a = top[i] ?? "", b = bottom[i] ?? "";
      for (const c of [a, b]) {
        const row = document.createElement("span");
        row.textContent = c === " " ? "\u00a0" : c;
        ch.append(row);
      }
      if (!a.trim() && !b.trim()) ch.classList.add("ch--space");
      word.append(ch);
    }
    el.append(word);
  };
  const init = (el) => { el.classList.add("rolls"); build(el, el.textContent.trim()); };

  return { init };
})();

for (const el of document.querySelectorAll(".nav a, .article-foot a")) Roll.init(el);

/* ---------- 1. relative dates ---------- */

for (const t of document.querySelectorAll("time[data-ago]")) {
  const days = Math.round((Date.now() - new Date(t.dateTime + "T00:00:00")) / 864e5);
  const [n, u] =
    days < 1 ? [0] : days < 30 ? [days, "day"] : days < 365 ? [Math.round(days / 30.4), "month"] : [Math.round(days / 365), "year"];
  t.querySelector(".ago").textContent = n ? `${n} ${u}${n > 1 ? "s" : ""} ago` : "today";
}

/* ---------- sound: a synthesized detent click ---------- */

const Sound = (() => {
  // Always on: clicks start after the reader's first tap, click or key press.
  let ctx = null;

  // Browsers only allow audio after a real gesture. iPhone Safari counts the
  // *end* of a tap (touchend / click), not touchstart, so listen to all of them.
  // Each gesture also nudges a suspended or "interrupted" context back to life.
  const unlock = () => {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
      }
      if (ctx.state !== "running") ctx.resume?.();
      // older iOS only unlocks once something has actually played inside the gesture
      if (!unlock.primed) {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
        unlock.primed = true;
      }
    } catch {}
  };
  for (const ev of ["pointerdown", "pointerup", "mousedown", "touchstart", "touchend", "click", "keydown"]) {
    addEventListener(ev, unlock, { passive: true, capture: true });
  }

  /* Haptics: a short pulse on any device with a vibration motor.
     Android and other browsers with the Vibration API use navigator.vibrate.
     iPhone Safari has no Vibration API; since iOS 18, toggling a native switch
     control gives a light system tap, so we flip a hidden one instead. */
  const iosTap = (() => {
    if ("vibrate" in navigator) return null;
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIOS) return null;
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.append(input);
    document.body.append(label);
    return () => label.click();
  })();

  function buzz() {
    // Browsers refuse vibration until the reader has tapped or clicked once.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try {
      if ("vibrate" in navigator) navigator.vibrate(8);
      else iosTap?.();
    } catch {}
  }

  let lastTick = 0;
  function click(strength = 1) {
    const t = performance.now();
    if (t - lastTick < 28) return; // never a buzz, always distinct detents
    lastTick = t;

    buzz();

    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = 0.13 * strength; // ≈5 dB under the first version: softer, still clearly audible
    out.connect(ctx.destination);

    // the "tick": a 4ms burst of filtered noise, crisp and dry
    const len = Math.floor(ctx.sampleRate * 0.004);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3600 + Math.random() * 400;
    bp.Q.value = 1.8;
    noise.connect(bp).connect(out);
    noise.start(now);

    // the "body": a light knock underneath
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1700 + Math.random() * 120, now);
    osc.frequency.exponentialRampToValueAtTime(850, now + 0.014);
    env.gain.setValueAtTime(0.3, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    osc.connect(env).connect(out);
    osc.start(now);
    osc.stop(now + 0.024);
  }

  return { click };
})();

/* ---------- 2. the dial ---------- */

const dial = document.querySelector(".dial");
const rows = [...document.querySelectorAll(".posts li")];

if (dial && rows.length) {
  const strip = dial.querySelector(".dial-strip");
  const ticks = [...dial.querySelectorAll(".tick")];
  const years = [...dial.querySelectorAll(".yr")];
  const yearStart = years.map((a) => Number(a.style.getPropertyValue("--i")));
  const last = rows.length - 1;
  // A label rides with the pointer through its year, then is pushed up by the next year's label
  // (2.6 detents ≈ the label's own height), like sticky section headers.
  const yearEnd = yearStart.map((s, k) => (k + 1 < yearStart.length ? Math.max(s, yearStart[k + 1] - 2.6) : last));
  const sp = parseFloat(getComputedStyle(dial).getPropertyValue("--sp")) || 14;

  let target = 0;      // where the dial wants to be (fractional post index)
  let pos = 0;         // where it is
  let vel = 0;
  let detent = 0;      // last whole post the pointer passed
  let hovering = false;
  let raf = 0;

  // Scroll progress maps onto the list: top of the page is the newest post,
  // the bottom is the oldest, and everything in between turns the dial continuously.
  function fromScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max <= 0) return 0;
    const progress = Math.min(1, Math.max(0, scrollY / max));
    const tops = rows.map((r) => r.getBoundingClientRect().top + scrollY);
    const line = tops[0] + progress * (tops[last] - tops[0]);
    for (let i = 0; i < last; i++) {
      if (line < tops[i + 1]) return i + (line - tops[i]) / (tops[i + 1] - tops[i]);
    }
    return last;
  }

  function paint() {
    strip.style.transform = `translate3d(0, ${(-pos * 100) / rows.length}%, 0)`;
    dial.style.setProperty("--pos", pos.toFixed(3));
    const near = Math.round(pos);
    if (near !== detent) {
      const steps = Math.abs(near - detent);
      if (detent !== -1) Sound.click(steps > 1 ? 1.1 : 1);
      detent = near;
      rows.forEach((r, i) => r.classList.toggle("is-active", i === near));
      ticks.forEach((t, i) => t.classList.toggle("is-active", i === near));
      let y = 0;
      yearStart.forEach((s, k) => { if (near >= s) y = k; });
      years.forEach((a, k) => a.toggleAttribute("aria-current", k === y));
    }
    // each year label rides beside the pointer while the dial is inside that year
    years.forEach((a, k) => {
      const at = Math.min(Math.max(pos, yearStart[k]), yearEnd[k]);
      a.style.top = `${at * sp - 2}px`;
    });
    // light the ticks by distance from the pointer, for a lens-like falloff
    ticks.forEach((t, i) => t.style.setProperty("--d", Math.min(1, Math.abs(i - pos) / 5).toFixed(3)));
  }

  // A critically damped spring: fluid, never overshoots past a detent.
  let prev = 0;
  function frame(t) {
    const dt = Math.min(0.032, (t - (prev || t)) / 1000) || 0.016;
    prev = t;
    if (reduce) { pos = target; vel = 0; }
    else {
      const k = 260, c = 2 * Math.sqrt(k);
      vel += (-(pos - target) * k - vel * c) * dt;
      pos += vel * dt;
    }
    paint();
    if (Math.abs(pos - target) > 0.001 || Math.abs(vel) > 0.001) raf = requestAnimationFrame(frame);
    else { pos = target; paint(); raf = 0; prev = 0; }
  }
  const go = (to) => {
    target = Math.max(0, Math.min(last, to));
    if (!raf) raf = requestAnimationFrame(frame);
  };

  addEventListener("scroll", () => { if (!hovering) go(fromScroll()); }, { passive: true });
  addEventListener("resize", () => go(fromScroll()));

  rows.forEach((r, i) => {
    const a = r.querySelector("a");
    r.addEventListener("pointerenter", () => { hovering = true; go(i); });
    r.addEventListener("pointerleave", () => { hovering = false; });
    a.addEventListener("focus", () => go(i));
  });

  // Year labels turn the dial to that year's first post as the page scrolls there.
  years.forEach((a, k) => a.addEventListener("click", () => { hovering = false; go(yearStart[k]); }));

  pos = target = fromScroll();
  detent = -1; // first paint sets the active post without a click
  paint();
  document.documentElement.classList.add("has-dial");
}

/* ---------- 3. rolling article date ---------- */

const odo = document.querySelector("time.odo");
if (odo && !reduce) {
  const text = odo.textContent;
  const yearSpan = odo.querySelector("span");
  const parts = [];
  const make = (str, into) => {
    for (const ch of str) {
      if (!/\d/.test(ch)) { into.append(ch); continue; }
      const reel = document.createElement("span");
      reel.className = "reel";
      reel.setAttribute("aria-hidden", "true");
      const col = document.createElement("span");
      col.className = "reel-col";
      for (let n = 0; n <= 9; n++) col.append(Object.assign(document.createElement("span"), { textContent: n }));
      reel.append(col);
      into.append(reel);
      parts.push([col, Number(ch)]);
    }
  };
  const head = text.slice(0, text.length - (yearSpan?.textContent.length || 0));
  odo.textContent = "";
  make(head, odo);
  if (yearSpan) {
    const y = document.createElement("span");
    make(yearSpan.textContent, y);
    odo.append(y);
  }
  // the reels are decoration; screen readers get the date as plain text
  odo.append(Object.assign(document.createElement("span"), { className: "visually-hidden", textContent: text }));
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      parts.forEach(([col, n], i) => {
        col.style.transitionDelay = `${120 + i * 45}ms`;
        col.style.transform = `translateY(${-n * 10}%)`;
      })
    )
  );
}
