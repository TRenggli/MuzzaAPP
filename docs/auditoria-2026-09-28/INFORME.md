# Revisión del producto y del sistema

Fecha: 28/09/2026. Código local: `7754758`. Alcance: análisis, navegación de la demo y propuesta; sin cambios en la lógica de la aplicación ni despliegues.

## Evaluación

Hay una base aprovechable y bastante más completa que una aplicación de pedidos simple. La separación plataforma → negocio → sucursal, los permisos en base de datos, el catálogo, las recetas, la caja, los reportes y la operación sin conexión son decisiones útiles para el objetivo comercial.

Sin embargo, tener pantallas para varias sucursales no demuestra capacidad para operar muchas cadenas simultáneamente. Antes de ofrecer esa promesa hay que corregir integridad y concurrencia, asegurar la recuperación de operaciones y medir carga. No hace falta empezar de cero ni cambiar de framework para solucionar esos problemas.

El siguiente módulo funcional debería ser **Salón y mesas: mapa numerado de cada sucursal con cuentas abiertas**, como pidió el usuario. La landing comercial es otra pieza necesaria, pero no reemplaza el trabajo sobre el motor de operaciones.

## Qué se verificó

- Lectura de estructura, navegación, autenticación, almacenamiento local, acceso a Supabase, migraciones y políticas, pedidos, caja, stock, gastos, catálogo, carta online, pagos e infraestructura de pruebas/publicación.
- Acceso con la cuenta suministrada, panel del dueño con dos sucursales y operación en El viejo andres.
- Recorrido visual y funcional de Inicio, Vender, Pedidos, Caja, Stock, Gastos y ganancias, Carta online, Configuración, Menú y precios, Historial y Reportes. Vista estrecha inicial y escritorio de 1440 × 960. No se completó una matriz exhaustiva de dispositivos.
- Creación del pedido **#1138**, mesa **99**, nombre **PRUEBA AUDITORÍA**, una Coca-Cola de $4.200, usando Cobrar después. Apareció en Pedidos. Se abrió el diálogo de cobro, sin confirmar pago. Se anuló con motivo de auditoría y se verificó Anulado en Historial. Queda registro histórico, sin venta cobrada. No se enviaron mensajes por WhatsApp.
- `npm run check`: chequeo TypeScript y **41 pruebas aprobadas**. Los mensajes de error simulados de las pruebas de sincronización no son fallos de la suite.
- Tres reproducciones locales adicionales sobre los módulos reales, usando la nube simulada del repositorio: pérdida de descuento de stock concurrente, números de emergencia repetidos y descarte de un lote ante rechazo permanente.

No se ejecutaron las pruebas SQL contra la base desplegada, pruebas de carga, cobros reales de Mercado Pago ni una restauración de respaldo. No se ingresó como cocina, cajero, delivery o administrador de plataforma. Sus permisos se revisaron en código. El navegador de inspección dejó de responder durante el intento de continuar a Clientes; por eso Clientes, Equipo y las pantallas restantes del dueño/plataforma no se consideran recorridas funcionalmente. La carta de esta sucursal estaba sin publicar: no se verificó un pedido público completo. No se certifica que las migraciones locales coincidan exactamente con la base remota.

## Estructura y lógica actual

| Capa | Archivos | Responsabilidad |
|---|---|---|
| Interfaz | `index.html`, `css/`, `js/views/` | Aplicación JavaScript sin framework, vistas por módulos y plantillas HTML |
| Navegación | `js/app.js` | Rutas con hash, sesión, panel de negocio y selección de sucursal |
| Roles | `js/auth.js` | Dueño, encargado, cajero, cocina, delivery; visibilidad de módulos |
| Operación | `js/store.js` | Estado de sucursal, cálculos, pedidos, caja, recetas, stock, cola de sincronización |
| Acceso remoto | `js/cloud.js` | Supabase Auth, RPC, consultas, funciones y eventos Realtime |
| Persistencia | `supabase/migrations/` | PostgreSQL con organizaciones, sucursales, miembros, pedidos y documentos JSON |
| Servidor | `supabase/functions/` | Plataforma, altas/invitaciones, personal, perfil y Mercado Pago |
| Cliente público | `carta.html`, `js/carta*.js`, `js/online.js` | Carta, pedidos web, seguimiento y aceptación en sucursal |
| Dispositivo | `sw.js`, IndexedDB, localStorage | Archivos offline, caché de datos, operaciones pendientes y numeración reservada |
| Calidad | `tests/`, `types/`, `.github/workflows/` | Pruebas unitarias, tipos y publicación condicionada a checks |

Flujo actual: el vendedor arma un carrito → `createOrder` crea el pedido y modifica stock local → la interfaz muestra éxito → `save/diff/flush` envían documentos y pedidos a la nube en llamadas separadas → Realtime propaga cambios. El cobro agrega pagos y vincula una sesión de caja; un trigger evita cambiar campos económicos de ventas cobradas. Es una base útil, pero la confirmación visual local y la confirmación durable del servidor son eventos diferentes.

## Hallazgos priorizados

P1: resolver antes de ampliar uso comercial con varios operadores. P2: siguiente etapa de robustez/producto. No se asigna capacidad numérica sin mediciones.

### P1 · El stock puede perder consumos concurrentes

`js/store.js:782` modifica `ing.stock` en el equipo; `upsert_docs` combina valores JSON, no movimientos atómicos. Reproducción: dos terminales parten de 10 kg y venden 0,3 kg cada una. Ambas envían stock = 9,7. La combinación remota queda en **9,7 en vez de 9,4**.

Solución: registrar movimientos de inventario con identidad única y aplicar cada consumo una sola vez en una transacción del servidor. Vincularlos a pedido/línea/tanda. Las anulaciones deben generar movimientos compensatorios, contemplando si hubo consumo real o merma, y no depender de que el navegador termine de ejecutarse.

### P1 · Un rechazo permanente descarta operaciones del mismo lote

`js/store.js:275–330`: `flush` extrae toda la cola y guarda primero documentos, después pedidos. Si una llamada falla con error permanente, el lote no se vuelve a encolar. Reproducción local: un documento rechazado deja **0 operaciones pendientes y 0 pedidos enviados**, aunque había un pedido en el lote.

La recarga del servidor no recupera una venta que nunca llegó a él. Hace falta registrar resultados por operación, conservar pendientes válidos y mantener una bandeja de conflictos recuperables. La venta, su cobro y los movimientos relacionados necesitan límites de transacción explícitos.

### P1 · Permisos del servidor más amplios que los de la interfaz

En `js/auth.js` cocina y delivery solo tienen Pedidos. En `001_multisucursal.sql:157–160`, INSERT/UPDATE de pedidos dependen de `can_branch`, que comprueba pertenencia pero no la acción por rol. `orders_guard` valida sumas y ventas ya cobradas; no limita cada operación de un pedido sin cobrar a cajero/encargado. Las políticas de documentos también permiten muchas colecciones a cualquier miembro de la sucursal.

Además, `member_update` se autoriza por administración del negocio sin restringir los destinos a las sucursales asignadas al encargado. Es más amplio que las restricciones de la función `staff` y permite evitar ese circuito usando acceso directo a la tabla. Revisar también integridad de `org_id` y `branch_id`: las claves foráneas independientes no garantizan por sí mismas que correspondan al mismo negocio.

Estos son hallazgos de las migraciones locales, no ataques ejecutados contra la demo. Solución: matriz de acciones por rol aplicada en servidor, escritura mediante operaciones específicas y pruebas negativas con distintos negocios/sucursales. Validar precios, descuentos autorizados, autoría, sesiones de caja y estados, además de que las sumas cierren.

### P1 · Aceptación web y creación de pedido no son atómicas

`js/online.js:119` primero marca el pedido web aceptado y después llama a `S.createOrder` local. Un cierre o corte entre ambos pasos puede dejar un pedido aceptado sin pedido operativo. La marca evita doble aceptación, pero no garantiza la creación de la comanda.

Solución: una función del servidor que acepte y cree el pedido, líneas y movimientos en la misma transacción, con reintentos idempotentes. Si se repite la solicitud debe devolver el mismo pedido.

### P1 · Cajas y cobros necesitan reglas de concurrencia

`openSession` comprueba solamente el estado local (`js/store.js:681`). Dos terminales pueden abrir sesiones simultáneamente. El cobro se presenta como completado antes de confirmar el servidor, y no hay una operación atómica de reserva/cobro que evite dos operadores actuando sobre el mismo saldo. El trigger protege una venta una vez registrada, pero no deshace un segundo cobro físico ya recibido.

Definir si hay una caja por sucursal o cajas por terminal/turno. Agregar restricciones y operaciones de apertura, cobro y cierre en servidor. Los pagos requieren identificador único, saldo pendiente y conciliación. En modo offline hay que diseñar cómo se limita o asigna el cobro concurrente: no se puede prometer exclusión global entre equipos desconectados.

### P1 · Recuperación de Mercado Pago dependiente del navegador

`js/mp.js` consulta periódicamente el pago y devuelve el resultado al diálogo de venta. `supabase/functions/mp/index.ts` registra el estado de MP, pero no hay un circuito de webhook/conciliación que complete por sí solo la venta comercial tras cerrar el navegador. No se verificó con dinero real.

Hace falta vinculación durable pago↔venta, validación del importe y moneda en servidor, recuperación de pagos acreditados pendientes de registrar, y reprocesamiento idempotente. Debe distinguirse siempre el cobro al comensal de la suscripción que el negocio paga por usar el software.

### P2 · Numeración de emergencia repetida

`js/store.js:435` usa segundos del reloj cuando se agotan los bloques. En una reproducción de cinco llamadas consecutivas devolvió **el mismo número cinco veces**. Los UUID internos son distintos: no se trata de cinco filas con el mismo ID, sino de identificadores visibles ambiguos.

Usar una identificación provisional realmente única por dispositivo/operación y reconciliarla, o impedir emitir un comprobante definitivo si no quedan números. Probar también pestañas simultáneas, dado que comparten localStorage.

### P2 · Ventas históricas incompletas en gastos de sucursal

La caché trae 45 días (`LOCAL_DAYS`). `js/views/gastos.js` permite elegir 12 meses pero calcula mediante `S.profit`, que solo usa `S.data.orders`. Por lo tanto puede mostrar gastos completos y ventas parciales o vacías para meses anteriores. Reportes usa consulta histórica; Gastos no sigue ese mismo circuito.

Consultar agregados del período en servidor e indicar cuando un reporte offline esté incompleto. Corregir también el texto de Configuración que todavía dice 120 días y el rótulo de clientes compartidos: actualmente se cargan por sucursal.

### P2 · Carga y mantenimiento con crecimiento

`branchData` pagina, lo cual evita truncar a 1.000 filas, pero carga **todos los documentos** de la sucursal y 45 días de pedidos completos. `diff` vuelve a recorrer y serializar las colecciones. Gastos, movimientos, clientes y auditoría remota pueden crecer sin límite de lectura equivalente. El canal de documentos se filtra por negocio y luego descarta otras sucursales en el cliente cuando corresponde.

Separar datos operativos del historial, pedir agregados/páginas bajo demanda, medir memoria y tiempos, y reducir suscripciones a lo necesario. Para el núcleo de dinero, mesas e inventario convienen entidades y restricciones explícitas; el JSON puede conservarse donde aporta flexibilidad, por ejemplo apariencia/configuración. No hace falta sustituir Supabase para comenzar.

### P2 · Offline y recuperación aún necesitan pruebas de fallos reales

El guardado usa temporizadores de 250/400 ms y la cola global cambia al cambiar de sucursal. IndexedDB silencia errores de escritura. `flush` no espera el envío existente cuando `flushing` ya es true. Hay riesgos que requieren reproducción adicional: cerrar la app durante persistencia, cambiar sucursal durante un envío, recargar con una operación en vuelo y reencontrarse con datos remotos más nuevos.

Separar colas por sucursal y usuario/dispositivo, persistir antes de confirmar al operador, mantener operaciones en vuelo hasta ACK y mostrar conflictos accionables. El JSON descargable es una exportación de la copia local, no evidencia de respaldo completo ni de restauración probada.

### P2 · La capa SaaS todavía es manual

Existen módulos, cupo de sucursales y suspensión; el alta la hace plataforma. No se encontró un ciclo de suscripciones con planes versionados, períodos, prueba, facturas de suscripción, reintentos de pago, cambios de plan y portal del cliente. El registro público general está cerrado. Tampoco hay una landing de presentación del software.

## Lectura visual y experiencia

La identidad cálida, los botones grandes, las categorías y el carrito visible funcionan bien para una pizzería. Las pantallas separan operación y administración y las ayudas contextualizadas reducen la barrera inicial. Conviene preservar eso.

Para una persona que comienza desde su casa, 13 secciones y dos niveles pueden resultar excesivos. Mostrar inicialmente Vender, Pedidos, Caja y Menú, con activación progresiva de delivery, stock, equipo y salón. El dueño de una sola sucursal puede entrar directamente a operar, manteniendo disponible la administración.

Para un local con personal, priorizar acciones rápidas, búsqueda, acceso de teclado y estados inequívocos. La cocina no debería enviar una bebida “al horno” ni exigir cobrar una mesa para marcar un plato entregado. Para cadenas, dar visibilidad a sucursal activa, estado de conexión y permisos, y reducir decoración/movimiento en pantallas de uso intensivo. No basar estados solamente en colores.

## Salón y mesas: propuesta concreta

Ubicación: **Sucursal → Salón y mesas**, al lado de Vender y Pedidos. Disponible solo donde se habilite el módulo. Cada sucursal tiene su propio mapa; el dueño cambia de sucursal desde el selector existente. El panel de negocio muestra ocupación y ventas agregadas, sin mezclar mesas de distintos locales.

### Mapa

- Sectores configurables: salón, patio, terraza, barra.
- Mesas redondas, cuadradas o rectangulares con número visible, capacidad y posición. Identificador interno estable independiente del número.
- Modo de edición exclusivo para encargado/dueño: agregar, numerar, ubicar y redimensionar. El modo de atención no permite arrastrar accidentalmente.
- Cada mesa muestra número, estado textual e indicador visual, comensales, tiempo desde apertura, responsable e importe pendiente.
- Estados de atención: libre, ocupada, cuenta solicitada, limpieza y fuera de servicio. Reservas puede ser una extensión posterior. Los estados de cocina pertenecen a las comandas, no a la mesa completa.
- En celular: mapa desplazable y vista de lista alternativa, botones grandes y ficha de mesa en pantalla completa. En escritorio/tablet: mapa con panel lateral.

### Atención

1. Tocar Mesa 5 → abrir cuenta e indicar comensales y mozo.
2. Agregar Coca-Cola → confirmar primera tanda. Queda en cuenta; se dirige a barra o entrega directa.
3. Agregar pizza → enviar solo esa nueva tanda a cocina, sin reimprimir lo anterior.
4. Agregar otra pizza más tarde → segunda comanda de cocina, misma cuenta.
5. Ver por separado total consumido, pagos ya recibidos y saldo. El estado de cada tanda puede avanzar sin cerrar la mesa.
6. Pedir cuenta → pre-cuenta; cobrar saldo o dividirlo según modalidad admitida.
7. Con saldo cero, cerrar atención, emitir comprobante y pasar a limpieza/libre. Mantener historial de quién hizo cada acción.

La primera entrega debería incluir mapa, cuentas abiertas, tandas, cobro total/mixto, movimiento de cuenta a otra mesa y anulaciones autorizadas. Separar cuenta por productos, unir mesas/cuentas, reservas, propinas y QR de autoservicio son ampliaciones con reglas propias. Un pago mixto entre medios, que ya existe, no equivale a dividir una cuenta entre comensales o aceptar pagos parciales a lo largo de la cena.

### Datos y reglas

Propuesta de entidades: `dining_areas`, `dining_tables`, `table_sessions`, `table_session_tables`, `order_batches`, `order_items`, `payments` y `stock_movements`. Reutilizar pedidos y tickets donde sea compatible, mediante migración incremental.

Todas las entidades deben pertenecer a negocio y sucursal coherentes. Una mesa no puede tener dos atenciones activas incompatibles. El servidor confirma apertura, nuevas líneas, envío, traslado y cobro. Cada operación lleva un identificador único; repetirla por mala conexión no crea una segunda pizza ni otro pago. Usar versiones/conflictos o bloqueo transaccional para operaciones competidoras, y Realtime para actualizar la vista una vez confirmadas.

**No guardar toda la cuenta como un array que dos mozos reescriben completo**: ambos podrían agregar un producto y el último envío borrar el primero. Las líneas/tandas tienen identidad propia. El precio y la receta/costo aplicables deben quedar fijados según las reglas comerciales de la operación.

Pruebas de aceptación: dos mozos agregan simultáneamente; un mismo envío se reintenta; caja cobra mientras otro agrega; se corta internet; se mueve una mesa; se anula una línea ya preparada; se cierra con saldo pendiente; un usuario intenta acceder a otra sucursal. Ninguna prueba debe perder líneas, duplicar cobros o mezclar locales.

## Producto comercial y landing

Separar tres experiencias: web comercial del software, acceso privado de negocios y carta pública de cada pizzería. Ejemplo conceptual de rutas: `/`, `/app` y `/carta/...`, preservando/redirigiendo enlaces actuales durante una futura migración. La carta online existente vende comida; la landing nueva presenta el sistema.

La landing debería explicar el beneficio desde el emprendimiento hasta varias sucursales, mostrar capturas reales, una demostración breve de venta→cocina→cobro y otra del mapa de mesas, comparación de planes, preguntas frecuentes y botones claros **Ver demo**, **Empezar** y **Acceso a clientes**. Usar animación breve que explique el flujo y respete reducción de movimiento; evitar promesas de escala u operación offline no verificadas.

Segmentación inicial para validar, sin fijar precios todavía:

| Plan conceptual | Usuario | Funciones principales |
|---|---|---|
| Emprender | Una persona desde casa | Pedidos, catálogo, caja simple, carta y retiro/delivery |
| Local | Negocio con personal y salón | Mesas/mapa, cocina, roles, stock y gastos |
| Cadena | Varias sucursales | Consolidado, administración central, permisos por local y menú modelo |

La separación de datos, la integridad de cobros y la recuperación son requisitos de todos los planes. Los precios se definen después de medir costo de infraestructura, soporte, incorporación de clientes y disposición a pagar. Evitar cobrar por cada empleado si desincentiva cuentas individuales y trazabilidad.

El circuito comercial necesita alta guiada, creación de negocio/sucursal, elección de módulos, recuperación de acceso, estado de suscripción, pago/reintentos, cambio de plan y soporte. Incluir preparación de términos, privacidad y definición del alcance de comprobantes antes de comercializar; esta auditoría no determina validez fiscal o cumplimiento normativo.

## Orden recomendado y criterios de salida

1. **Integridad**: permisos por acción, cola durable, stock transaccional, aceptación web atómica y cobro/conciliación. Salida: pruebas de dos terminales y fallos de red sin pérdida ni duplicación.
2. **Salón y mesas**: mapa y cuentas abiertas integradas con cocina y caja. Salida: atender una cena con varias tandas y dos operadores, con una cuenta final correcta.
3. **Piloto comercial y experiencia de inicio**: incorporar un emprendimiento y un local reales con asistencia; recoger problemas de un turno completo y medir soporte necesario.
4. **Landing y suscripciones**: presentación, planes y acceso; automatizar altas/cobro según alcance comercial. El diseño de landing puede avanzar en paralelo, sin bloquear correcciones.
5. **Escala de cadenas**: cargas representativas por sucursal, crecimiento de historial, latencia de comandos y Realtime, consumo de base de datos y fallos controlados. Definir objetivos medibles antes de anunciar límites o garantías. Probar backups/restauración y observabilidad de servidor además de errores del navegador.

## Evidencia y entregables

- `mesa-pedido.png`: pedido de prueba visible en el tablero.
- `prueba-anulada.png`: registro anulado sin cobro en Historial.
- `reproducir.mjs`: reproducciones locales, sin conexión al servidor real.
- `mapa-mesas.html`: maqueta conceptual interactiva con datos ficticios. No está conectada a la app ni implementa concurrencia, pagos o persistencia reales. Se verificaron la sintaxis de JavaScript y su entrega HTTP local (200); la validación visual y de interacción de esta maqueta quedó pendiente porque el navegador de inspección no logró adjuntar la nueva pestaña. Las capturas de la app tienen baja nitidez; los estados del pedido se corroboraron también mediante el contenido accesible del navegador.

Conclusión de producto: conservar la base y su identidad, corregir primero las garantías de operación y agregar un salón real. El crecimiento debe venir de un mismo sistema modular, con complejidad progresiva, validada mediante uso y mediciones.
