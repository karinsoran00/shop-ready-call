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
let lookupSeq = 0;
let remaining = 0;
let syncedAt = 0;
let wakeLock = null;
const vapidPublicKey = "BE4aPqu9CkHScuixs2LAA-a88Rq6GoAeY-wBHDHA9aVqyX9ovPHt3Rti0GxOu57hRbjIuB_n6U625YHvPhXVQD4";
let soundReady = false;
let alerting = false;
let chimeId = 0;
let phoneSaved = false;
let savingPhone = false;

function assignedNumber() {
  const bill = (new URLSearchParams(location.search).get("order") || "").trim();
  return /^[0-9]{1,6}$/.test(bill) ? bill : "";
}

function show(section) {
  entry.hidden = section !== entry;
  waiting.hidden = section !== waiting;
  ready.hidden = section !== ready;
}

ringButton.addEventListener("click", () => {
  if (!canRing()) return;
  if (alerting && !alarm.paused) {
    stopChime();
    readyLine.textContent = "Seen. Please come to the counter.";
    return;
  }
  if (alerting) playRing(chimeId);
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
  waitNote.textContent = seconds === 0
    ? "Any moment now."
    : "The phone rings when the order is ready.";
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
  const registration = await navigator.serviceWorker.register("sw.js?v=2");
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const subscription = await phoneSubscription();
      const saved = await saveOrderAlert(number, subscription);
      if (saved.ok) return true;
    } catch {
      // Try again. A failed save must not close the page.
    }
  }
  return false;
}

function canUsePush() {
  if (isIos() && !isStandalone()) return false;
  return typeof Notification !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window;
}

function keepAlertAfterLeaving() {
  if (phoneSaved || savingPhone || !canUsePush()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  savingPhone = true;
  rememberThisPhone().then((ok) => {
    phoneSaved = ok === true;
    savingPhone = false;
  }).catch(() => {
    savingPhone = false;
  });
}

function filePlaying(name) {
  const current = alarm.currentSrc || alarm.src || "";
  return current.indexOf(name) !== -1;
}

function showOnLockScreen(title) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: "Shop Ready-Call"
    });
    navigator.mediaSession.playbackState = "playing";
    if (!showOnLockScreen.ready) {
      showOnLockScreen.ready = true;
      const resume = () => {
        try {
          if (alerting) playRing(chimeId);
        } catch {
          // The page stays open.
        }
      };
      navigator.mediaSession.setActionHandler("play", resume);
      navigator.mediaSession.setActionHandler("pause", resume);
      navigator.mediaSession.setActionHandler("stop", resume);
    }
  } catch {
    // The sound still plays without the lock screen line.
  }
}

function clearLockScreen() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
  } catch {
    // The sound is already stopped.
  }
}

let arming = false;

function useAlarm() {
  alarm.muted = false;
  alarm.volume = 1;
  if (!filePlaying("alarm.wav")) alarm.src = "alarm.wav?v=9";
}

function silence() {
  if (alerting) return;
  alarm.loop = false;
  alarm.pause();
  try { alarm.currentTime = 0; } catch { /* already quiet */ }
}

function armRing() {
  if (!canRing() || alerting || !number || soundReady || arming) return;
  arming = true;
  useAlarm();
  alarm.loop = false;
  const played = alarm.play();
  const quiet = () => {
    if (alerting) return;
    alarm.loop = false;
    alarm.pause();
    try { alarm.currentTime = 0; } catch { /* already quiet */ }
  };
  quiet();
  if (!played) {
    arming = false;
    return;
  }
  played.then(() => {
    arming = false;
    quiet();
    soundReady = true;
  }).catch(() => {
    arming = false;
    soundReady = false;
  });
}

function canRing() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return window.matchMedia("(pointer: coarse)").matches;
}

window.addEventListener("pointerdown", () => {
  try {
    if (alerting) {
      if (alarm.paused) playRing(chimeId);
      return;
    }
    armRing();
  } catch {
    // A tap must not close the page.
  }
}, true);

document.addEventListener("visibilitychange", () => {
  try {
    if (document.hidden || !canRing()) return;
    if (alerting && alarm.paused) playRing(chimeId);
  } catch {
    // Coming back must not close the page.
  }
});

let lastHeard = 0;
alarm.addEventListener("timeupdate", () => {
  try {
    const now = Date.now();
    if (!number || now - lastHeard < 2000) return;
    lastHeard = now;
    lookup();
  } catch {
    // A missed check must not close the page.
  }
});

async function keepAwake() {
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // The screen can still stay on if the phone is set that way.
  }
}

function playRing(id) {
  if (!canRing() || id !== chimeId || !alerting) return;
  useAlarm();
  alarm.loop = true;
  showOnLockScreen("Your order is ready");
  if (!alarm.paused) {
    soundReady = true;
    return;
  }
  try { alarm.currentTime = 0; } catch { /* play from the start */ }
  const played = alarm.play();
  if (!played) return;
  played.then(() => {
    if (id !== chimeId || !alerting) return;
    soundReady = true;
    speakReady(readyNumber.textContent);
  }).catch(() => {
    if (id !== chimeId) return;
    soundReady = false;
  });
}

function stopChime() {
  chimeId += 1;
  alerting = false;
  alarm.onended = null;
  alarm.loop = false;
  alarm.pause();
  try { alarm.currentTime = 0; } catch { /* already stopped */ }
  ringButton.hidden = true;
  clearLockScreen();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function notifyReady(bill) {
  if (!canRing() || document.hidden) return;
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
  if (!canRing() || document.hidden || !("speechSynthesis" in window)) return;
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
  try {
    if (!document.hidden && navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400, 150, 700]);
  } catch {
    // Vibration is optional.
  }
  ringButton.hidden = false;
  ringButton.textContent = "I see it";
  showOnLockScreen("Your order is ready");
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
  document.title = "Your order";
  show(waiting);
  paintClock();
  silence();
}

function showReady(order) {
  const entered = mode !== "ready";
  mode = "ready";
  readyNumber.textContent = order.billNumber;
  if (reviewUrl) {
    reviewLink.href = reviewUrl;
    reviewLink.hidden = false;
  }
  show(ready);
  if (!entered) return;
  readyLine.textContent = "Your order is ready. Please come to the counter.";
  startChime(order.billNumber);
}

async function lookup() {
  try {
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
  } catch {
    // A missed check must not close the page. The next one tries again.
  }
}

async function startWatch(notify) {
  if (!number) return;
  if (notify) await notify;
  await keepAwake();
  if (canUsePush() && typeof Notification !== "undefined" && Notification.permission === "granted") keepAlertAfterLeaving();
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
