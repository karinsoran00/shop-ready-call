self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Your order is ready";
  const body = data.body || "Please come to the counter.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: "shop-ready",
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || "./" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const windowClient of windows) {
      if (windowClient.url.indexOf(url) !== -1 && "focus" in windowClient) return windowClient.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
