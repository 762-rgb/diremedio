// ============================
// Service Worker - Remédios do Di
// Gerencia notificações em background
// ============================

const CACHE_NAME = 'diremedio-cache-v3';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/fonts/Baloo2-VariableFont_wght.ttf'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/')) {
        return; // Don't cache API calls
    }
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

// --- Push Notification Handler ---

self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const payload = event.data.json();
        const options = {
            body: payload.body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: `di-remedio-${payload.medId}`,
            renotify: true,
            requireInteraction: true,
            vibrate: [800, 200, 800, 200, 800, 500, 800, 200, 800, 200, 800],
            actions: [
                { action: 'done', title: '✅ Dose Dada' },
                { action: 'snooze', title: '⏰ 5 min' }
            ],
            data: { 
                medId: payload.medId, 
                medName: payload.medName, 
                dosage: payload.dosage 
            }
        };

        event.waitUntil(
            self.registration.showNotification(payload.title, options)
        );
    } catch (err) {
        console.error('Erro ao processar push event:', err);
    }
});

self.addEventListener('notificationclick', (event) => {
    const notification = event.notification;
    const action = event.action;
    const data = notification.data;

    notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            let activeClient = null;
            
            // Focar janela existente ou abrir nova
            for (const client of clientList) {
                if (client.url.includes('/') && 'focus' in client) {
                    client.focus();
                    activeClient = client;
                    break;
                }
            }
            if (!activeClient && self.clients.openWindow) {
                return self.clients.openWindow('/').then(client => {
                    if (client) sendActionToClient(client, action, data);
                });
            } else if (activeClient) {
                sendActionToClient(activeClient, action, data);
            }
        })
    );
});

function sendActionToClient(client, action, data) {
    if (action === 'done') {
        client.postMessage({ type: 'ACTION_DONE', medId: data.medId });
    } else if (action === 'snooze') {
        client.postMessage({ type: 'ACTION_SNOOZE', medId: data.medId });
    }
}
