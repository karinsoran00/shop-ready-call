const entry = document.querySelector("#entry");
const waiting = document.querySelector("#waiting");
const ready = document.querySelector("#ready");
const entryMessage = document.querySelector("#entry-message");
const waitNumber = document.querySelector("#wait-number");
const clockEl = document.querySelector("#clock");
const waitNote = document.querySelector("#wait-note");
const readyNumber = document.querySelector("#ready-number");
const readyLine = document.querySelector("#ready-line");
const ringButton = document.querySelector("#ring");
const reviewLink = document.querySelector("#review");
const alarm = document.querySelector("#alarm");

let number = "";
let mode = "entry";
let reviewUrl = "";
let pollTimer = 0;
let remaining = 0;
let syncedAt = 0;
let wakeLock = null;
let soundReady = false;
let alerting = false;
let ringsLeft = 0;
let chimeId = 0;

function assignedNumber() {
  const bill = (new URLSearchParams(location.search).get("order") || "").trim();
  return /^[0-9]{1,6}$/.test(bill) ? bill : "";
}

function show(section) {
  entry.hidden = section !== entry;
  waiting.hidden = section !== waiting;
  ready.hidden = section !== ready;
}

document.addEventListener("pointerdown", () => {
  if (number && !soundReady) unlock();
});

ringButton.addEventListener("click", async () => {
  if (!isPhone()) return;
  if (alerting && !alarm.paused) {
    stopChime();
    readyLine.textContent = "Seen. Please come to the counter.";
    return;
  }
  await unlock();
  startChime(readyNumber.textContent);
});

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function shownSeconds() {
  const passed = Math.floor((Date.now() - syncedAt) / 1000);
  return Math.max(0, remaining - passed);
}

function paintClock() {
  if (mode !== "waiting") return;
  const seconds = shownSeconds();
  if (seconds === 0) clockEl.textContent = "Soon";
  else clockEl.textContent = clock(seconds);
  if (!isPhone()) {
    waitNote.textContent = seconds === 0 ? "Any moment now." : "Waiting for the order.";
    return;
  }
  if (!soundReady) {
    waitNote.textContent = "The phone blocked the sound. Turn off silent mode and tap the page.";
    return;
  }
  waitNote.textContent = seconds === 0
    ? "Any moment now. Keep this page open."
    : "Sound is on. Keep this page open. The alert continues until you tap I see it.";
}

function isPhone() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

async function unlock() {
  if (!isPhone()) return;
  alarm.loop = false;
  alarm.volume = 1;
  try {
    alarm.currentTime = 0;
    await alarm.play();
    soundReady = true;
    window.setTimeout(() => {
      if (mode !== "ready") {
        alarm.pause();
        alarm.currentTime = 0;
      }
    }, 350);
  } catch {
    soundReady = false;
  }
}

function askNotify() {
  try {
    if (!isPhone() || !("Notification" in window) || !window.isSecureContext) return Promise.resolve();
    if (Notification.permission !== "default") return Promise.resolve();
    return Notification.requestPermission().catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

async function keepAwake() {
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // The screen can still stay on if the phone is set that way.
  }
}

function playRing(id) {
  if (!isPhone() || id !== chimeId || !alerting) return;
  alarm.loop = true;
  alarm.volume = 1;
  try { alarm.currentTime = 0; } catch { /* play from the start */ }
  alarm.play().catch(() => {
    if (id !== chimeId) return;
    ringButton.hidden = false;
    ringButton.textContent = "Tap to ring";
  });
}

function stopChime() {
  chimeId += 1;
  alerting = false;
  ringsLeft = 0;
  alarm.onended = null;
  alarm.loop = false;
  alarm.pause();
  try { alarm.currentTime = 0; } catch { /* already stopped */ }
  ringButton.hidden = true;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function notifyReady(bill) {
  if (!isPhone()) return;
  const title = "Your food is ready";
  const body = "Order " + bill + ". Please come to the counter.";
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const note = new Notification(title, { body, tag: "shop-ready", requireInteraction: true });
      note.onclick = () => {
        window.focus();
        note.close();
      };
    }
  } catch {
    // The sound and the screen still alert the phone.
  }
}

function speakReady(bill) {
  if (!isPhone() || !("speechSynthesis" in window)) return;
  const line = new SpeechSynthesisUtterance("Your food is ready. Order " + bill + ".");
  line.lang = "en";
  speechSynthesis.cancel();
  speechSynthesis.speak(line);
}

function startChime(bill) {
  document.title = "Food is ready";
  if (!isPhone()) return;
  stopChime();
  alerting = true;
  notifyReady(bill);
  speakReady(bill);
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400, 150, 700]);
  ringButton.hidden = false;
  ringButton.textContent = "I see it";
  playRing(chimeId);
}

function showEntry(text) {
  mode = "entry";
  stopChime();
  show(entry);
  entryMessage.textContent = text || "";
}

function showWaiting(order) {
  if (mode === "ready") stopChime();
  mode = "waiting";
  remaining = order.remainingSeconds;
  syncedAt = Date.now();
  waitNumber.textContent = order.billNumber;
  show(waiting);
  paintClock();
  if (isPhone() && !soundReady) {
    waitNote.textContent = "The phone blocked the sound. Turn off silent mode, then tap the page.";
  }
}

function showReady(order) {
  const entered = mode !== "ready";
  mode = "ready";
  readyNumber.textContent = order.billNumber;
  readyLine.textContent = "Your food is ready. Please come to the counter.";
  if (reviewUrl) {
    reviewLink.href = reviewUrl;
    reviewLink.hidden = false;
  }
  show(ready);
  if (entered) startChime(order.billNumber);
}

async function lookup() {
  const response = await shopFetch("/api/orders/lookup?number=" + encodeURIComponent(number));
  if (response.status === 404) {
    if (mode === "ready") return;
    showEntry("Number " + number + " is not on the list yet. Ask the counter.");
    return;
  }
  if (!response.ok) return;
  const order = await response.json();
  if (order.status === "ready") showReady(order);
  else showWaiting(order);
}

async function startWatch(notify) {
  if (!number) return;
  await unlock();
  if (notify) await notify;
  await keepAwake();
  await lookup();
  clearInterval(pollTimer);
  pollTimer = setInterval(lookup, 2000);
}

shopFetch("/api/config")
  .then((response) => response.json())
  .then((config) => {
    reviewUrl = config.reviewUrl || "";
    const name = config.name || "Shop Ready-Call";
    document.querySelectorAll("[data-shop-name]").forEach((el) => {
      el.textContent = name;
    });
  })
  .catch(() => {});

number = assignedNumber();
if (number) startWatch(askNotify());
else showEntry("Scan the QR from the counter.");

setInterval(paintClock, 1000);
