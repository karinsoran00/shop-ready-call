const entry = document.querySelector("#entry");
const waiting = document.querySelector("#waiting");
const ready = document.querySelector("#ready");
const entryMessage = document.querySelector("#entry-message");
const waitNumber = document.querySelector("#wait-number");
const clockEl = document.querySelector("#clock");
const waitNote = document.querySelector("#wait-note");
const readyNumber = document.querySelector("#ready-number");
const readyLine = document.querySelector("#ready-line");
const armButton = document.querySelector("#arm");
const ringButton = document.querySelector("#ring");
const reviewLink = document.querySelector("#review");
const alarm = document.querySelector("#alarm");

let number = "";
let mode = "entry";
let reviewUrl = "";
let pollTimer = 0;
let lookupSeq = 0;
let remaining = 0;
let syncedAt = 0;
let wakeLock = null;
const vapidPublicKey = "BE4aPqu9CkHScuixs2LAA-a88Rq6GoAeY-wBHDHA9aVqyX9ovPHt3Rti0GxOu57hRbjIuB_n6U625YHvPhXVQD4";
let soundReady = false;
let alertsOn = false;
let alertNote = "";
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

armButton.addEventListener("click", () => {
  enableAlerts();
});

ringButton.addEventListener("click", async () => {
  if (!canRing()) return;
  if (alerting && !alarm.paused) {
    stopChime();
    readyLine.textContent = "Seen. Please come to the counter.";
    return;
  }
  await armSound();
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
  armButton.hidden = alertsOn;
  if (isIos() && !isStandalone()) {
    armButton.hidden = false;
    waitNote.textContent = "On iPhone, tap Share, then Add to Home Screen. Open that icon and tap Turn alerts on.";
    return;
  }
  if (!alertsOn) {
    waitNote.textContent = alertNote || "Tap Turn alerts on for this phone.";
    return;
  }
  waitNote.textContent = seconds === 0
    ? "Any moment now. You can leave this page."
    : "Alerts are on. You can leave this page. The phone rings when the order is ready.";
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

async function phoneSubscription() {
  const registration = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
  }
  return subscription;
}

async function rememberThisPhone() {
  let lastError = "This phone was not saved.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const subscription = await phoneSubscription();
      const saved = await saveOrderAlert(number, subscription);
      if (saved.ok) {
        alertsOn = true;
        alertNote = "";
        return;
      }
      lastError = saved.error || lastError;
    } catch (error) {
      lastError = error && error.message ? error.message : lastError;
    }
  }
  alertsOn = false;
  alertNote = "This phone was not saved. Tap Turn alerts on again.";
}

async function enableAlerts() {
  await armSound();
  alertNote = "";
  if (isIos() && !isStandalone()) {
    alertsOn = false;
    paintClock();
    return;
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    alertsOn = false;
    alertNote = "This phone cannot alert after you leave the page. Keep this page open.";
    paintClock();
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alertsOn = false;
    alertNote = "Tap Allow so this phone can ring after you leave the page.";
    paintClock();
    return;
  }
  armButton.disabled = true;
  await rememberThisPhone();
  armButton.disabled = false;
  paintClock();
}

async function restoreAlerts() {
  if (isIos() && !isStandalone()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  await rememberThisPhone();
  paintClock();
}

function canRing() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

async function armSound() {
  if (!canRing()) return;
  alarm.loop = false;
  alarm.muted = false;
  alarm.volume = 1;
  try {
    alarm.currentTime = 0;
    await alarm.play();
    soundReady = true;
    if (mode !== "ready" || !alerting) {
      alarm.pause();
      alarm.currentTime = 0;
    }
  } catch {
    soundReady = false;
  }
}

function askNotify() {
  try {
    if (!canRing() || !("Notification" in window) || !window.isSecureContext) return Promise.resolve();
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
  if (!canRing() || id !== chimeId || !alerting) return;
  alarm.loop = true;
  alarm.muted = false;
  alarm.volume = 1;
  try { alarm.currentTime = 0; } catch { /* play from the start */ }
  const played = alarm.play();
  if (!played) return;
  played.then(() => {
    soundReady = true;
  }).catch(() => {
    if (id !== chimeId) return;
    ringButton.hidden = false;
    ringButton.textContent = "Tap to ring";
    readyLine.textContent = "Tap the button so the phone can ring.";
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
  if (!canRing()) return;
  const title = "Your order is ready";
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
  if (!canRing() || !("speechSynthesis" in window)) return;
  const line = new SpeechSynthesisUtterance("Your order is ready. Order " + bill + ".");
  line.lang = "en";
  speechSynthesis.cancel();
  speechSynthesis.speak(line);
}

function startChime(bill) {
  document.title = "Your order is ready";
  if (!canRing()) return;
  chimeId += 1;
  alerting = true;
  alarm.onended = null;
  notifyReady(bill);
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400, 150, 700]);
  ringButton.hidden = false;
  ringButton.textContent = soundReady ? "I see it" : "Tap to ring";
  playRing(chimeId);
  if (soundReady) speakReady(bill);
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
}

function showReady(order) {
  const entered = mode !== "ready";
  mode = "ready";
  readyNumber.textContent = order.billNumber;
  readyLine.textContent = "Your order is ready. Please come to the counter.";
  if (reviewUrl) {
    reviewLink.href = reviewUrl;
    reviewLink.hidden = false;
  }
  show(ready);
  if (entered) startChime(order.billNumber);
}

async function lookup() {
  const seq = ++lookupSeq;
  const response = await shopFetch("/api/orders/lookup?number=" + encodeURIComponent(number));
  if (seq !== lookupSeq) return;
  if (response.status === 404) {
    if (mode === "ready") return;
    showEntry("Number " + number + " is not on the list yet. Ask the counter.");
    return;
  }
  if (!response.ok) return;
  const order = await response.json();
  if (seq !== lookupSeq) return;
  if (order.status === "ready") showReady(order);
  else showWaiting(order);
}

async function startWatch(notify) {
  if (!number) return;
  if (notify) await notify;
  await keepAwake();
  restoreAlerts();
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
if (number) startWatch();
else showEntry("Scan the QR from the counter.");

setInterval(paintClock, 1000);
