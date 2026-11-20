const digits = document.querySelector("#digits");
const message = document.querySelector("#message");
const addButton = document.querySelector("#add");
const ordersEl = document.querySelector("#orders");
const countEl = document.querySelector("#count");

let number = "";
let minutes = 0;
let orders = [];
let syncedAt = Date.now();
let saving = false;

function paintNumber() {
  digits.textContent = number || "—";
  addButton.disabled = saving || number.length === 0 || minutes === 0;
}

function setMessage(text) {
  message.textContent = text || "";
}

document.querySelectorAll("[data-digit]").forEach((button) => {
  button.addEventListener("click", () => {
    if (number.length >= 6) return;
    number += button.dataset.digit;
    setMessage("");
    paintNumber();
  });
});

document.querySelector("[data-action='clear']").addEventListener("click", () => {
  number = "";
  paintNumber();
});

document.querySelector("[data-action='back']").addEventListener("click", () => {
  number = number.slice(0, -1);
  paintNumber();
});

document.querySelectorAll("[data-minutes]").forEach((button) => {
  button.addEventListener("click", () => {
    minutes = Number(button.dataset.minutes);
    document.querySelectorAll("[data-minutes]").forEach((other) => {
      other.classList.toggle("is-on", other === button);
    });
    setMessage("");
    paintNumber();
  });
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  if (event.key >= "0" && event.key <= "9") {
    if (number.length < 6) number += event.key;
    paintNumber();
  } else if (event.key === "Backspace") {
    number = number.slice(0, -1);
    paintNumber();
  } else if (event.key === "Escape") {
    number = "";
    paintNumber();
  } else if (event.key === "Enter") {
    addOrder();
  }
});

addButton.addEventListener("click", addOrder);

async function addOrder() {
  if (addButton.disabled) return;
  saving = true;
  paintNumber();
  setMessage("");
  try {
    const response = await shopFetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number, minutes })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error || "Could not add the order.");
      return;
    }
    number = "";
    paintNumber();
    await loadOrders();
  } catch {
    setMessage("The server did not answer.");
  } finally {
    saving = false;
    paintNumber();
  }
}

function left(order) {
  const passed = Math.floor((Date.now() - syncedAt) / 1000);
  return Math.max(0, order.remainingSeconds - passed);
}

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function paintOrders() {
  const waiting = orders.filter((order) => order.status === "waiting").length;
  countEl.textContent = waiting === 1 ? "1 waiting" : waiting + " waiting";
  ordersEl.replaceChildren();

  if (orders.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No orders yet.";
    ordersEl.append(empty);
    return;
  }

  for (const order of orders) {
    const row = document.createElement("article");
    row.className = "order";
    row.dataset.id = String(order.id);

    const text = document.createElement("div");
    const title = document.createElement("p");
    title.className = "order-number";
    title.textContent = order.billNumber;
    const meta = document.createElement("p");
    meta.className = "order-meta";
    if (order.status === "ready") {
      meta.textContent = "Ready";
    } else {
      const seconds = left(order);
      meta.textContent = seconds === 0 ? "Any moment · " + order.minutes + " min" : clock(seconds) + " · " + order.minutes + " min";
      if (seconds === 0) meta.classList.add("is-late");
    }
    text.append(title, meta);

    const button = document.createElement("button");
    button.type = "button";
    if (order.status === "ready") {
      button.className = "quiet";
      button.textContent = "Picked up";
      button.addEventListener("click", () => removeOrder(order.id));
    } else {
      button.className = "ready-button";
      button.textContent = "Ready";
      button.addEventListener("click", () => markReady(order.id, button));
    }

    row.append(text, button);
    ordersEl.append(row);
  }
}

function sameList(next) {
  if (next.length !== orders.length) return false;
  return next.every((order, index) => {
    const current = orders[index];
    return current.id === order.id
      && current.billNumber === order.billNumber
      && current.status === order.status
      && current.minutes === order.minutes;
  });
}

async function loadOrders() {
  const response = await shopFetch("/api/orders");
  if (!response.ok) return;
  const next = await response.json();
  const unchanged = sameList(next);
  orders = next;
  syncedAt = Date.now();
  if (unchanged) paintTimes();
  else paintOrders();
}

async function markReady(id, button) {
  button.disabled = true;
  const response = await shopFetch("/api/orders/" + id + "/ready", { method: "POST" });
  if (!response.ok) button.disabled = false;
  await loadOrders();
}

async function removeOrder(id) {
  await shopFetch("/api/orders/" + id, { method: "DELETE" });
  await loadOrders();
}

async function loadLink() {
  const page = new URL("./", location.href).href;
  const linkEl = document.querySelector("#link");
  const qr = document.querySelector("#qr");
  if (!isLocalServer()) {
    linkEl.textContent = page;
    qr.src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=" + encodeURIComponent(page);
    return;
  }
  const response = await shopFetch("/api/link");
  if (!response.ok) {
    linkEl.textContent = page;
    return;
  }
  const link = await response.json();
  linkEl.textContent = link.url;
  const hint = document.querySelector("#hint");
  if (link.onThisComputerOnly) {
    hint.textContent = "This address only works on this computer. On the shop Wi-Fi, phones can open the page.";
  }
}

shopFetch("/api/config")
  .then((response) => response.json())
  .then((config) => {
    document.querySelectorAll("[data-shop-name]").forEach((el) => {
      el.textContent = config.name || "Shop Ready-Call";
    });
    document.title = "Staff · " + (config.name || "Shop Ready-Call");
  })
  .catch(() => {});

function paintTimes() {
  for (const row of ordersEl.querySelectorAll(".order")) {
    const order = orders.find((item) => item.id === Number(row.dataset.id));
    if (!order || order.status !== "waiting") continue;
    const meta = row.querySelector(".order-meta");
    const seconds = left(order);
    meta.textContent = seconds === 0
      ? "Any moment · " + order.minutes + " min"
      : clock(seconds) + " · " + order.minutes + " min";
    meta.classList.toggle("is-late", seconds === 0);
  }
}

loadLink();
loadOrders();
setInterval(loadOrders, 2000);
setInterval(paintTimes, 1000);
