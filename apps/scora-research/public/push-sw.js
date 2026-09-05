/* Web Push handlers, imported into the generated PWA service worker (next.config.ts →
   workboxOptions.importScripts). Shows the notification the sender pushes, and focuses/opens
   the app on click. Kept dependency-free and defensive. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: "Scora Research", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Scora Research";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "scora-regime",
    renotify: true,
    data: { url: data.url || "/macro" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/macro";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ("focus" in w) { w.navigate(url); return w.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
