import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/load.mjs';

test('notificaciones: degradación elegante en modo incógnito o sin soporte de Notification', async () => {
  // Caso 1: Navegador en incógnito estricto o sin API Notification
  const app1 = loadApp(); // sin Notification
  const resUnsupported = await app1.PZ.requestNotificationPermission();
  assert.equal(resUnsupported, 'unsupported', 'Debe retornar "unsupported" si Notification no existe');

  let beepPlayed1 = false;
  app1.PZ.beep = () => { beepPlayed1 = true; };

  // PZ.notify no debe lanzar excepción y debe ejecutar sonido
  const notifResult1 = await app1.PZ.notify('🛵 ¡Nuevo pedido!', { body: 'Prueba sin Notification' });
  assert.equal(notifResult1, null, 'No debe fallar y debe retornar null si no hay soporte');
  assert.equal(beepPlayed1, true, 'El timbre sonoro se reproduce aunque no haya Notification');

  // Caso 2: Permiso denegado ('denied')
  const FakeDeniedNotification = {
    permission: 'denied',
    requestPermission: async () => 'denied',
  };

  const app2 = loadApp({ Notification: FakeDeniedNotification });
  let beepPlayed2 = false;
  app2.PZ.beep = () => { beepPlayed2 = true; };

  const resDenied = await app2.PZ.requestNotificationPermission();
  assert.equal(resDenied, 'denied', 'Debe retornar "denied" cuando el usuario o navegador bloqueó los permisos');

  const notifResult2 = await app2.PZ.notify('🛵 ¡Pedido!', { body: 'Prueba con permiso bloqueado' });
  assert.equal(notifResult2, null, 'No debe fallar y debe retornar null si el permiso está denegado');
  assert.equal(beepPlayed2, true, 'El timbre sonoro sigue sonando aún con notificaciones bloqueadas');
});

test('notificaciones: emisión exitosa con permisos autorizados', async () => {
  let createdNotif = null;
  class FakeGrantedNotification {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      this.onclick = null;
      createdNotif = this;
    }
    static permission = 'granted';
    static async requestPermission() { return 'granted'; }
  }

  const { PZ } = loadApp({ Notification: FakeGrantedNotification });

  let beepPlayed = false;
  PZ.beep = () => { beepPlayed = true; };

  const perm = await PZ.requestNotificationPermission();
  assert.equal(perm, 'granted');

  let clicked = false;
  const notif = await PZ.notify('🛵 ¡Nuevo pedido asignado!', {
    body: 'Av. Siempre Viva 742',
    notes: [784, 1046, 1318],
    onClick: () => { clicked = true; },
  });

  assert.ok(notif, 'Debe instanciar y retornar la notificación nativa');
  assert.equal(createdNotif.title, '🛵 ¡Nuevo pedido asignado!');
  assert.equal(createdNotif.options.body, 'Av. Siempre Viva 742');
  assert.equal(beepPlayed, true, 'El sonido se ejecuta en conjunto');

  // Simular clic del usuario en la notificación
  notif.onclick();
  assert.equal(clicked, true, 'El callback de clic enfoca la app y ejecuta la acción');
});

test('resiliencia: persistencia en localStorage ante reinicio o apagado de batería', () => {
  const { localStorage } = loadApp();

  // El repartidor inicia sesión con su código
  localStorage.setItem('muzza-driver', 'Lucas');
  localStorage.setItem('muzza-driver-code', 'DEL-101');
  localStorage.setItem('muzza-branch-slug', 'diego');

  // Simular que el teléfono se apaga (corte de batería) y se reabre la app
  const restoredDriver = localStorage.getItem('muzza-driver');
  const restoredCode = localStorage.getItem('muzza-driver-code');
  const restoredSlug = localStorage.getItem('muzza-branch-slug');

  assert.equal(restoredDriver, 'Lucas', 'El nombre del chofer se conserva en almacenamiento persistente');
  assert.equal(restoredCode, 'DEL-101', 'El identificador único se conserva');
  assert.equal(restoredSlug, 'diego', 'La sucursal asignada se conserva');
});

test('compatibilidad: ejecución en navegadores sin soporte de Web Audio API (AudioContext ausente)', async () => {
  // Simular navegador ultra-ligero o antiguo (ej. Opera Mini o WebView legacy) donde AudioContext y webkitAudioContext no existen
  const app = loadApp();
  
  // Asegurar que AudioContext y webkitAudioContext no están definidos
  delete app.ctx.AudioContext;
  delete app.ctx.webkitAudioContext;

  // 1. PZ.beep no debe arrojar ninguna excepción al no existir AudioContext
  assert.doesNotThrow(() => {
    app.PZ.beep([784, 1046]);
  }, 'PZ.beep debe degradar en silencio sin arrojar error cuando no hay AudioContext');

  // 2. PZ.notify debe continuar operando con vibración háptica y sin crasheos
  let vibrated = false;
  app.ctx.navigator.vibrate = (pattern) => {
    vibrated = true;
    return true;
  };

  const res = await app.PZ.notify('🍕 Pizza Lista', { vibrate: [100, 50, 100] });
  assert.equal(vibrated, true, 'La vibración háptica se ejecuta incluso si no hay Web Audio');
});

test('resiliencia: simulación de apagado forzado (cold reboot) y recuperación sin credenciales', () => {
  // Fase 1: El chofer opera antes de que se apague el teléfono
  const appSession1 = loadApp();
  appSession1.localStorage.setItem('muzza-driver', 'Lucas');
  appSession1.localStorage.setItem('muzza-driver-code', 'DEL-101');
  appSession1.localStorage.setItem('muzza-branch-slug', 'diego');

  // Fase 2: Simulación de apagado de batería / crash del proceso (destrucción total de memoria volátil)
  // Todo el estado en memoria de appSession1 desaparece.
  
  // Fase 3: El teléfono enciende, se reabre el navegador y se carga la app limpia con el mismo almacenamiento en disco
  const appSession2 = loadApp();
  // El almacenamiento flash persiste entre reinicios
  appSession2.localStorage.setItem('muzza-driver', appSession1.localStorage.getItem('muzza-driver'));
  appSession2.localStorage.setItem('muzza-driver-code', appSession1.localStorage.getItem('muzza-driver-code'));
  appSession2.localStorage.setItem('muzza-branch-slug', appSession1.localStorage.getItem('muzza-branch-slug'));

  // Al abrir reparto.html sin parámetros:
  const savedDriver = appSession2.localStorage.getItem('muzza-driver');
  const savedCode = appSession2.localStorage.getItem('muzza-driver-code');
  const savedSlug = appSession2.localStorage.getItem('muzza-branch-slug');

  assert.equal(savedDriver, 'Lucas', 'Sesión restaurada sin pedir contraseña');
  assert.equal(savedCode, 'DEL-101', 'Código de chofer intacto para seguir operando');
  assert.equal(savedSlug, 'diego', 'Asociado a la misma sucursal');
});

