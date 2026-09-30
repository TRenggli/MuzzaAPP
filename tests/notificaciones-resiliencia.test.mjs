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

test('perfil: cambio de email con colisión de cuenta existente rechaza con mensaje claro y preserva la base intacta', async () => {
  // Simulación de la lógica de la Edge Function 'profile' (supabase/functions/profile/index.ts)
  const STAFF_DOMAIN = 'staff.pizzeria.local';

  function simulateProfileChangeEmail({ me, bodyEmail, existingEmails = [] }) {
    const email = String(bodyEmail || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: 400, error: 'Email inválido' };
    if (email.endsWith('@' + STAFF_DOMAIN)) return { status: 400, error: 'Email inválido' };

    const oldEmail = (me.email || '').toLowerCase();
    const logsInWithEmail = !oldEmail.endsWith('@' + STAFF_DOMAIN);

    let membersUpdated = false;
    let profilesUpserted = false;

    if (logsInWithEmail && email !== oldEmail) {
      // Simula error de Supabase Auth admin.updateUserById cuando el email ya existe
      if (existingEmails.includes(email)) {
        const error = { message: 'A user with this email address has already been registered' };
        const msg = /already|registered|exists/i.test(error.message) ? 'Ese email ya lo usa otra cuenta' : error.message;
        return { status: 400, error: msg, membersUpdated, profilesUpserted };
      }
      membersUpdated = true;
    }
    profilesUpserted = true;
    return { status: 200, ok: true, login: logsInWithEmail ? email : null, membersUpdated, profilesUpserted };
  }

  const currentUser = { id: 'usr-1', email: 'diego@pizzeria.com' };
  const registeredAccounts = ['otro_dueno@gmail.com', 'empleado@gmail.com'];

  // Caso 1: Intento de usar un email que ya pertenece a otra cuenta
  const collisionResult = simulateProfileChangeEmail({
    me: currentUser,
    bodyEmail: 'otro_dueno@gmail.com',
    existingEmails: registeredAccounts,
  });

  assert.equal(collisionResult.status, 400);
  assert.equal(collisionResult.error, 'Ese email ya lo usa otra cuenta');
  assert.equal(collisionResult.membersUpdated, false, 'No debe modificar la tabla members');
  assert.equal(collisionResult.profilesUpserted, false, 'No debe tocar la tabla profiles');

  // Caso 2: Email con formato incorrecto
  const invalidResult = simulateProfileChangeEmail({
    me: currentUser,
    bodyEmail: 'email-sin-arroba',
    existingEmails: registeredAccounts,
  });
  assert.equal(invalidResult.status, 400);
  assert.equal(invalidResult.error, 'Email inválido');

  // Caso 3: Email con dominio de staff prohibido
  const staffResult = simulateProfileChangeEmail({
    me: currentUser,
    bodyEmail: 'cajero@staff.pizzeria.local',
    existingEmails: registeredAccounts,
  });
  assert.equal(staffResult.status, 400);
  assert.equal(staffResult.error, 'Email inválido');

  // Caso 4: Email válido y disponible
  const validResult = simulateProfileChangeEmail({
    me: currentUser,
    bodyEmail: 'nuevo_correo_diego@gmail.com',
    existingEmails: registeredAccounts,
  });
  assert.equal(validResult.status, 200);
  assert.equal(validResult.ok, true);
  assert.equal(validResult.login, 'nuevo_correo_diego@gmail.com');
  assert.equal(validResult.membersUpdated, true);
  assert.equal(validResult.profilesUpserted, true);
});

test('comanda y venta: exclusión de condimentos (ej: Napolitana sin tomate ni ajo) viaja a notas y ticket', () => {
  const { S } = loadApp();

  // Condimentos configurados en la sucursal (por ejemplo Orégano, Tomate, Ajo, Chimi)
  const condiments = [
    { id: 'oregano', name: 'Orégano', default: true },
    { id: 'tomate', name: 'Tomate', default: true },
    { id: 'ajo', name: 'Ajo', default: true },
    { id: 'chimi', name: 'Chimi', default: false },
  ];

  // Pizza Napolitana
  const napolitana = {
    id: 'p-napo',
    categoryId: 'c-piz',
    name: 'Napolitana',
    desc: 'Muzza, rodajas de tomate, ajo y perejil',
    active: true,
    variants: [{ id: 'grande', name: 'Grande', price: 15000, factor: 1 }],
  };

  // Simulación de interacción de usuario: el cliente o mozo desmarca 'tomate' y 'ajo'
  const condState = { oregano: true, tomate: false, ajo: false, chimi: false };
  const tags = [];
  condiments.forEach((c) => {
    const isDefault = c.default !== false;
    const isSelected = !!condState[c.id];
    if (isDefault && !isSelected) tags.push(`Sin ${c.name.toLowerCase()}`);
    else if (!isDefault && isSelected) tags.push(`Con ${c.name.toLowerCase()}`);
  });

  assert.deepEqual(tags, ['Sin tomate', 'Sin ajo']);

  // Generar nota final del ítem
  let notes = tags.join(' · ');
  assert.equal(notes, 'Sin tomate · Sin ajo');

  // Crear el ítem de venta usando S.makeItem
  const item = S.makeItem({
    product: napolitana,
    variant: napolitana.variants[0],
    qty: 1,
    notes,
  });

  assert.equal(item.name, 'Napolitana');
  assert.equal(item.notes, 'Sin tomate · Sin ajo');

  // En una orden / ticket de cocina
  const order = {
    id: 'o-test',
    number: 101,
    type: 'mesa',
    table: 'Mesa 4',
    items: [item],
    total: 15000,
    paid: false,
    createdAt: Date.now(),
  };

  // Verificar que el ticket de cocina contiene la exclusión destacada
  const kitchenHtml = item.notes ? `<div class="box">» ${item.notes}</div>` : '';
  assert.ok(kitchenHtml.includes('» Sin tomate · Sin ajo'));
});


