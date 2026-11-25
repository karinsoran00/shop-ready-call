self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Your order is ready";
  const body = data.body || "Please come to the counter.";
  const url = data.url || "./";
  const bill = (String(url).match(/order=([0-9]{1,6})/) || [])[1] || "";
  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        body,
        tag: bill ? "shop-ready-" + bill : "shop-ready",
        renotify: true,
        requireInteraction: true,
        data: { url }
      });
    } catch {
      try {
        await self.registration.showNotification(title, { body, data: { url } });
      } catch {
        // The order page still opens when the customer comes back.
      }
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  try { event.notification.close(); } catch { /* already closed */ }
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil((async () => {
    try {
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const windowClient of windows) {
        if (windowClient.url.indexOf(url) !== -1 && "focus" in windowClient) return windowClient.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    } catch {
      // The alert was shown. Opening the page can wait.
    }
  })());
});
