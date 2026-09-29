# 🍕 MuzzaAPP — Sistema de gestión integral para pizzerías y locales gastronómicos

Sistema web (instalable como app) para pizzerías de uno o muchos locales. Datos en la nube (Supabase), funciona sin internet y se adapta a celular, tablet y compu.

## Tres niveles, una sola sesión

| Nivel | Quién | Qué hace |
|---|---|---|
| **🛠️ Plataforma** | El creador del sistema | Crea negocios a medida (dueño, módulos, máximo de sucursales), los suspende o reactiva, resetea contraseñas y entra a dar soporte. |
| **🏢 Negocio** | El dueño | Panel general: resumen en vivo de todas las sucursales, alertas, **finanzas** (ventas, gastos, ganancia, margen, food cost), **equipo** (rendimiento de cada persona), sucursales, códigos y menú modelo. Con un toque **opera cualquier sucursal** sin cerrar sesión. |
| **🏪 Sucursal** | Encargado y empleados | La operación: vender, cobrar, tickets, pedidos, caja, clientes, stock, gastos y ganancias, equipo y reportes. Todo propio de esa sucursal. |

Un negocio de una sola persona funciona igual: el dueño tiene todas las funciones. Si crece, agrega sucursales y empleados sin cambiar nada.

## Cómo se suma la gente

1. **Vos** (plataforma) creás el negocio y el usuario del dueño → le mandás los datos por WhatsApp desde el mismo panel.
2. **El dueño** crea sucursales y genera un **código** para el encargado de cada una (`ABCD-1234`, un solo uso, vence en 7 días).
3. **El encargado** abre el **enlace** (o escanea el QR, o toca *Tengo un código de sucursal*) → elige su usuario y contraseña. Queda solo en su sucursal.
4. **El encargado** genera enlaces para cajeros, cocina y delivery de su sucursal, o les crea el usuario directamente.
5. **Al primer ingreso** cada persona completa su perfil: nombre completo, teléfono y CUIL (se valida el dígito verificador). Desde *Mi perfil* cambia foto, correo y contraseña. El dueño y el encargado ven los datos de su gente en *Equipo*.

## Qué ve el dueño

- **Resumen:** vendido hoy en todas las sucursales, cajas abiertas, pedidos en curso, alertas (faltantes de stock, diferencias de caja, sucursal que gasta más de lo que vende), comparativa, productos top y horarios pico.
- **Finanzas:** por sucursal y total: ventas, gastos, ganancia, margen, food cost (costo teórico de mercadería según recetas), ventas vs gastos por día y en qué se gasta.
- **Equipo:** por persona: cuánto cobró, tickets, ticket promedio, descuentos, anulaciones, diferencias en los cierres de caja que hizo, sueldo pagado y cuánto vende por cada $1 de sueldo.
- **Menú modelo:** menú oficial del negocio que se copia a las sucursales nuevas; se puede mandar a las existentes (solo precios, agregar faltantes o reemplazar) y aumentar precios en varias sucursales a la vez.

## Ayudas y uso en cualquier equipo

- Cada pantalla muestra un **consejo** la primera vez que se entra, y el botón **❓** de la barra superior abre su guía cuando se necesite.
- Revisado en celular chico (360 px), celular (375 px), tablet vertical (768 px), tablet horizontal (1024 px) y compu, con todos los perfiles: sin scroll horizontal y con botones del tamaño del dedo.

## Carta online (pedidos por WhatsApp)

Cada sucursal puede publicar su carta en `carta.html?l=<dirección>` (sin instalar nada, se abre desde el celular del cliente):

1. El cliente mira la carta, elige tamaños, **mitad y mitad**, agregados y aclaraciones, y arma el carrito.
2. Carga sus datos (retiro, delivery con zona de envío o desde la mesa con un QR por mesa) y cómo va a pagar.
3. El pedido **se guarda en el sistema** con los precios calculados por el servidor (no se confía en lo que manda el teléfono) y se abre **WhatsApp** con todo el detalle para mandarlo al local.
4. En el local suena un aviso y el pedido aparece arriba en **Pedidos**: con **Aceptar** pasa a la cocina con todo cargado (sin tipearlo); con **Rechazar** se le avisa al cliente.
5. El cliente sigue el estado de su pedido con el link que recibió.

En **Carta online** el encargado elige la dirección, el WhatsApp que recibe, el horario (o la pausa), qué productos se ven, las fotos, los colores, la letra, el logo y la portada, con **vista previa en vivo**. También imprime el QR para la vidriera o para cada mesa.

## Mercado Pago · QR con el monto

Con la cuenta de Mercado Pago del negocio conectada (Configuración → Cobros), al cobrar con **QR** se genera un código con el **monto exacto** y el cobro **se registra solo** cuando se acredita. El Access Token queda guardado en el servidor: ninguna persona del equipo lo puede ver. Sin Mercado Pago conectado sigue funcionando el QR fijo y la confirmación manual.

## Comprobantes sin posnet integrado

El comprobante se imprime **siempre**, se pague como se pague (efectivo, transferencia, QR o tarjeta en un posnet de cualquier marca). En *Configuración → Ticket e impresora* se elige si el papel dice **Comprobante de pago, Recibo, Ticket o Comprobante de venta**. Con tarjeta se elige débito o crédito y queda impreso.

## Seguridad del dinero (la base de datos manda)

- Una venta cobrada no se puede modificar: solo cambian su estado, repartidor y notas.
- El servidor verifica que subtotal, descuentos, envío, total y pagos cierren con los productos.
- Anular solo lo hace el dueño o un encargado, por una función del servidor que registra quién y por qué. Si opera un cajero, un encargado autoriza con sus datos.
- Las ventas reales no se pueden borrar (solo las de demostración). Una caja cerrada no se modifica.
- Cada equipo guarda 45 días de ventas; lo anterior se consulta a la nube.

## Calidad

- `tests/*.test.mjs`: 41 pruebas de cálculos de dinero, carta online (precios, horarios, mensaje de WhatsApp), Mercado Pago (con respuestas simuladas), CUIL, fechas y sincronización (`npm test`).
- **TypeScript sin compilar**: TODOS los archivos de la app (y el service worker) se revisan con `npm run types`; los nuevos se suman solos. Los tipos del negocio (producto, pedido, pagos, sucursal) están en `types/pz.d.ts`. Las funciones del servidor se revisan con `deno check`.
- `supabase/tests/integridad.sql` (18) y `supabase/tests/carta.sql` (24): pruebas de seguridad que simulan cajeros, encargados y clientes anónimos intentando hacer trampa (se deshacen solas).
- GitHub Actions corre todo en cada cambio y **publica la página solo si pasa**.
- Los errores que tenga la app en los equipos de los clientes quedan registrados en *Plataforma → Errores de la app*.

## Datos separados por sucursal

Cada sucursal tiene su propio menú, precios, clientes, pedidos, caja, stock y gastos. Los permisos se aplican **en la base de datos** (Row Level Security): un encargado o cajero no puede ver ni tocar otra sucursal aunque manipule la app.

## Accesos de demostración

Los usuarios y contraseñas de prueba se comparten por privado (no se publican en el repositorio).

## Módulos por negocio

Desde la plataforma se activan o desactivan por negocio: **Delivery, Mesas, Stock, Gastos y ganancias, Carta online, QR de Mercado Pago** y el **máximo de sucursales**. Un negocio suspendido no puede ingresar (sus datos se conservan).

## Sin internet

Cada equipo guarda una copia de su sucursal, encola los cambios y sincroniza al volver la conexión. Los números de pedido y comprobante se reservan por bloques para vender offline sin repetir. Si dos equipos cambian el mismo pedido, se combinan campo por campo.

## Publicarlo

Sitio estático: GitHub Pages, Netlify o Vercel lo sirven 24/7 (no depende de ninguna compu prendida). En el celular: Chrome → ⋮ → *Instalar app*.

## Estructura

```
js/cloud.js            Supabase: sesión, datos, tiempo real, finanzas, códigos
js/store.js            datos de la sucursal + sincronización offline + gastos
js/auth.js             niveles, roles, permisos y módulos
js/app.js              ingreso, códigos, cambio de nivel, navegación
js/views/plataforma.js panel del creador
js/views/negocio.js    panel del dueño (resumen, sucursales, finanzas, menú modelo)
js/views/equipo.js     equipo, códigos y rendimiento (sucursal y negocio)
js/views/gastos.js     gastos y ganancias de la sucursal
js/views/perfil.js     perfil de cada persona (foto, teléfono, CUIL, correo, contraseña)
carta.html, js/carta.js  carta online pública (clientes)
js/carta-core.js       precios, horario, mensaje de WhatsApp y temas de la carta
js/online.js           pedidos web en la sucursal (aceptar / rechazar)
js/views/online.js     panel "Carta online"
js/mp.js               cobro con QR de Mercado Pago
types/pz.d.ts          tipos del negocio (TypeScript)
tests/                 pruebas automáticas
js/views/*.js          operación de la sucursal
supabase/migrations/   esquema, RLS y funciones SQL
supabase/functions/    platform · join · staff · profile · mp · register (cerrado)
```
