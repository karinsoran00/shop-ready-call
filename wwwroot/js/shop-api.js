const sharedUrl = "https://xclvhrsyqjlgpxyfsyej.supabase.co/rest/v1/orders";
const sharedKey = "sb_publishable_N31cdZ7H-xfCcfgxT3lxCQ_otFWuRm_";

function isLocalServer() {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function customerUrl() {
  return new URL("./", location.href).href;
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

function sharedHeaders(prefer) {
  const headers = {
    apikey: sharedKey,
    "Content-Type": "application/json"
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function toOrder(row) {
  return withRemaining({
    id: row.id,
    billNumber: row.bill_number,
    minutes: row.minutes,
    status: row.status,
    createdAt: row.created_at,
    readyAt: row.ready_at
  });
}

async function sharedFetch(path, options) {
  const url = new URL(path, location.origin);
  const method = ((options && options.method) || "GET").toUpperCase();

  if (url.pathname === "/api/config") {
    return jsonResult({ name: "Shop Ready-Call", reviewUrl: "", pollSeconds: 2 }, 200);
  }

  if (url.pathname === "/api/link") {
    return jsonResult({ url: customerUrl(), onThisComputerOnly: false }, 200);
  }

  if (url.pathname === "/api/orders" && method === "GET") {
    const response = await fetch(sharedUrl + "?select=*&order=status.desc,created_at.asc", {
      headers: sharedHeaders()
    });
    if (!response.ok) return jsonResult({ error: "The list did not load." }, response.status);
    const rows = await response.json();
    return jsonResult(rows.map(toOrder), 200);
  }

  if (url.pathname === "/api/orders/lookup" && method === "GET") {
    const bill = billNumber(url.searchParams.get("number"));
    if (!bill) return jsonResult({ error: "Type the bill number." }, 400);
    const response = await fetch(
      sharedUrl + "?bill_number=eq." + encodeURIComponent(bill) + "&select=*",
      { headers: sharedHeaders() }
    );
    if (!response.ok) return jsonResult({ error: "The list did not load." }, response.status);
    const rows = await response.json();
    return rows.length
      ? jsonResult(toOrder(rows[0]), 200)
      : jsonResult({ error: "That number is not on the list." }, 404);
  }

  if (url.pathname === "/api/orders" && method === "POST") {
    const body = JSON.parse((options && options.body) || "{}");
    const bill = billNumber(body.number);
    const minutes = Number(body.minutes);
    if (!bill) return jsonResult({ error: "Type the bill number." }, 400);
    if (minutes < 1 || minutes > 120) return jsonResult({ error: "Choose the minutes." }, 400);
    const response = await fetch(sharedUrl + "?on_conflict=bill_number", {
      method: "POST",
      headers: sharedHeaders("resolution=merge-duplicates,return=representation"),
      body: JSON.stringify({
        bill_number: bill,
        minutes,
        status: "waiting",
        created_at: new Date().toISOString(),
        ready_at: null
      })
    });
    if (!response.ok) return jsonResult({ error: "The order was not added." }, response.status);
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return jsonResult(toOrder(row), 200);
  }

  const readyMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/ready$/);
  if (readyMatch && method === "POST") {
    const response = await fetch(sharedUrl + "?id=eq." + readyMatch[1], {
      method: "PATCH",
      headers: sharedHeaders("return=representation"),
      body: JSON.stringify({
        status: "ready",
        ready_at: new Date().toISOString()
      })
    });
    if (!response.ok) return jsonResult({ error: "That order is gone." }, response.status);
    const rows = await response.json();
    if (!rows.length) return jsonResult({ error: "That order is gone." }, 404);
    return jsonResult(toOrder(rows[0]), 200);
  }

  const deleteMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
  if (deleteMatch && method === "DELETE") {
    const response = await fetch(sharedUrl + "?id=eq." + deleteMatch[1], {
      method: "DELETE",
      headers: sharedHeaders("return=representation")
    });
    if (!response.ok) return jsonResult({ error: "That order is gone." }, response.status);
    const rows = await response.json();
    if (!rows.length) return jsonResult({ error: "That order is gone." }, 404);
    return new Response(null, { status: 204 });
  }

  return jsonResult({ error: "That page is not here." }, 404);
}

function shopFetch(path, options) {
  if (isLocalServer()) return fetch(path, options);
  return sharedFetch(path, options);
}
