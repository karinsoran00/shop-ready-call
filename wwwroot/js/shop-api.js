const orderKey = "shop-ready-orders";

function isLocalServer() {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function customerUrl() {
  return new URL("./", location.href).href;
}

function readOrders() {
  try {
    const saved = JSON.parse(localStorage.getItem(orderKey) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function writeOrders(orders) {
  localStorage.setItem(orderKey, JSON.stringify(orders));
}

function withRemaining(order) {
  let remainingSeconds = 0;
  if (order.status === "waiting") {
    const end = new Date(order.createdAt).getTime() + order.minutes * 60000;
    remainingSeconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  }
  return { ...order, remainingSeconds };
}

function billNumber(value) {
  const bill = String(value || "").trim();
  if (bill.length < 1 || bill.length > 6) return "";
  for (const c of bill) {
    if (c < "0" || c > "9") return "";
  }
  return bill;
}

function jsonResult(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function publicFetch(path, options) {
  const url = new URL(path, location.origin);
  const method = ((options && options.method) || "GET").toUpperCase();
  let orders = readOrders();

  if (url.pathname === "/api/config") {
    return jsonResult({ name: "Shop Ready-Call", reviewUrl: "", pollSeconds: 2 }, 200);
  }

  if (url.pathname === "/api/link") {
    return jsonResult({ url: customerUrl(), onThisComputerOnly: false }, 200);
  }

  if (url.pathname === "/api/orders" && method === "GET") {
    orders.sort((a, b) => {
      if (a.status !== b.status) return a.status === "waiting" ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
    return jsonResult(orders.map(withRemaining), 200);
  }

  if (url.pathname === "/api/orders/lookup" && method === "GET") {
    const bill = billNumber(url.searchParams.get("number"));
    if (!bill) return jsonResult({ error: "Type the bill number." }, 400);
    const order = orders.find((item) => item.billNumber === bill);
    return order ? jsonResult(withRemaining(order), 200) : jsonResult({ error: "That number is not on the list." }, 404);
  }

  if (url.pathname === "/api/orders" && method === "POST") {
    const body = JSON.parse((options && options.body) || "{}");
    const bill = billNumber(body.number);
    const minutes = Number(body.minutes);
    if (!bill) return jsonResult({ error: "Type the bill number." }, 400);
    if (minutes < 1 || minutes > 120) return jsonResult({ error: "Choose the minutes." }, 400);
    const now = new Date().toISOString();
    const existing = orders.find((item) => item.billNumber === bill);
    const order = {
      id: existing ? existing.id : Date.now(),
      billNumber: bill,
      minutes,
      status: "waiting",
      createdAt: now,
      readyAt: null
    };
    orders = orders.filter((item) => item.billNumber !== bill);
    orders.push(order);
    writeOrders(orders);
    return jsonResult(withRemaining(order), 200);
  }

  const readyMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/ready$/);
  if (readyMatch && method === "POST") {
    const id = Number(readyMatch[1]);
    const order = orders.find((item) => item.id === id);
    if (!order) return jsonResult({ error: "That order is gone." }, 404);
    if (order.status !== "ready") {
      order.status = "ready";
      order.readyAt = new Date().toISOString();
      writeOrders(orders);
    }
    return jsonResult(withRemaining(order), 200);
  }

  const deleteMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
  if (deleteMatch && method === "DELETE") {
    const id = Number(deleteMatch[1]);
    const next = orders.filter((item) => item.id !== id);
    if (next.length === orders.length) return jsonResult({ error: "That order is gone." }, 404);
    writeOrders(next);
    return new Response(null, { status: 204 });
  }

  return jsonResult({ error: "That page is not here." }, 404);
}

function shopFetch(path, options) {
  if (isLocalServer()) return fetch(path, options);
  return Promise.resolve(publicFetch(path, options));
}
