// @ts-check
/* ==========================================================================
   PZ.help — ayudas para guiar a cada persona:
     · un consejo corto arriba de cada pantalla la primera vez que entra
     · el botón ❓ de la barra superior abre la guía de la pantalla actual
   Los consejos vistos se recuerdan por usuario en este equipo.
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;

  // roles: si se indica, el consejo solo se muestra a esos roles
  const GUIDES = {
    /* ---------- Operación de la sucursal ---------- */
    inicio: {
      title: 'Inicio',
      intro: 'El resumen del día de tu sucursal: cuánto se vendió, qué pedidos están en curso y qué requiere atención.',
      tips: [
        'Tocá <b>Nueva venta</b> para empezar a cobrar.',
        'El recuadro <b>Atención</b> te avisa si la caja está cerrada, si hay pedidos demorados o insumos por acabarse.',
        'La barra de abajo (en el celular) o la de la izquierda (en la compu) te lleva a cada sección.',
      ],
    },
    vender: {
      title: 'Vender',
      intro: 'Tocá los productos para armar el pedido y después <b>Cobrar</b>.',
      tips: [
        'En las pizzas podés elegir <b>tamaño, mitad y mitad, agregados y aclaraciones</b> ("bien cocida", "sin aceitunas").',
        'Arriba del pedido elegís si es <b>mostrador, delivery, para retirar o mesa</b>. En delivery cargá la dirección: el cliente se guarda solo.',
        '<b>Cobrar</b>: elegí efectivo, transferencia, QR o tarjeta. En efectivo tocá con cuánto paga (o <b>Otro monto</b>) y te calcula el vuelto.',
        '<b>Cobrar después</b> manda el pedido a la cocina sin cobrarlo (por ejemplo, delivery que paga al recibir).',
        'Al cobrar se imprime el comprobante. Lo podés reimprimir o mandar por WhatsApp desde <b>Ventas</b>.',
      ],
    },
    pedidos: {
      title: 'Pedidos',
      intro: 'El tablero de la cocina y del delivery: cada pedido avanza de izquierda a derecha.',
      tips: [
        'Tocá el botón verde de cada tarjeta para pasarla al siguiente paso: <b>Recibido → Horno → Listo → En camino → Entregado</b>.',
        'Los pedidos que pasan el tiempo objetivo se marcan en <b>rojo</b>.',
        'Suena un aviso cuando entra un pedido nuevo. Si usan una tablet en la cocina, se actualiza sola.',
        'Con 💬 le avisás al cliente por WhatsApp en qué estado está su pedido.',
        'Los pedidos de la <b>carta online</b> aparecen arriba en verde: <b>Aceptar</b> los manda a la cocina con todo cargado; <b>Rechazar</b> le avisa al cliente.',
      ],
    },
    caja: {
      title: 'Caja',
      intro: 'Abrí la caja al empezar el turno y cerrala al terminar.',
      tips: [
        'Al <b>abrir</b> cargá el efectivo con el que arrancás (el fondo para dar vuelto).',
        'Si sacás plata del cajón, registralo en <b>Retiro / gasto</b>. Si es un gasto (verdura, proveedor), elegí la categoría y queda en Gastos.',
        'Al <b>cerrar</b> contá los billetes: el sistema te dice si sobra o falta plata e imprime el cierre Z.',
        'Una caja cerrada ya no se puede modificar.',
      ],
    },
    historial: {
      title: 'Ventas',
      intro: 'Todas las ventas: buscá, reimprimí el comprobante o anulá.',
      tips: [
        'Buscá por número, cliente o producto, y filtrá por fecha, medio de pago o estado.',
        'Con 🧾 ves el comprobante y lo podés reimprimir o mandar por WhatsApp.',
        'Anular necesita a un <b>encargado</b>: si sos cajero, te va a pedir su usuario y contraseña.',
        '<b>Exportar Excel</b> descarga las ventas del período.',
      ],
    },
    clientes: {
      title: 'Clientes',
      intro: 'Se agregan solos cuando cargás un pedido con teléfono.',
      tips: [
        'Las <b>notas</b> del cliente (por ejemplo "el timbre no anda") aparecen al tomarle el pedido.',
        'En 📜 ves todo lo que compró y podés <b>repetir un pedido</b> con un toque, con los precios de hoy.',
      ],
    },
    menu: {
      title: 'Menú y precios',
      intro: 'Los productos, precios y tamaños que se venden en esta sucursal.',
      tips: [
        '<b>Aumentar precios</b> sube todo el menú (o una categoría) un porcentaje, con redondeo.',
        'Marcá un producto como <b>agotado</b> para que no aparezca al vender.',
        'Cargá la <b>receta</b> de cada producto: el stock baja solo al vender y el sistema calcula cuánto te cuesta cada pizza.',
        '<b>Carta para clientes</b> arma un menú lindo para imprimir o mandar como PDF.',
      ],
    },
    online: {
      title: 'Carta online',
      intro: 'La carta que tus clientes abren en el celular: arman el pedido y te lo mandan por WhatsApp.',
      tips: [
        'Para publicarla: elegí la <b>dirección</b>, cargá el <b>WhatsApp</b> que recibe los pedidos y activá <b>Carta publicada</b>.',
        'Cada pedido llega también a <b>Pedidos</b> (con aviso sonoro): tocá <b>Aceptar</b> y pasa a la cocina con todo cargado, sin tipear nada.',
        'En <b>Diseño</b> elegís colores, letra, logo y portada. La vista previa muestra al instante cómo queda.',
        'En <b>Productos y fotos</b> elegís qué se ve y le ponés foto a cada producto.',
        'Imprimí el <b>QR</b> para la vidriera, el mostrador o cada mesa. Con <b>Pausar pedidos</b> frenás los pedidos una noche complicada.',
      ],
    },
    stock: {
      title: 'Stock',
      intro: 'Los insumos de la sucursal y cuánto queda.',
      tips: [
        'Cargá las compras con <b>+ Entrada</b> y las pérdidas con <b>− Ajuste</b>.',
        'Cuando un insumo baja del mínimo se pone en rojo y aparece en <b>Lista de compras</b>, lista para mandar por WhatsApp.',
      ],
    },
    gastos: {
      title: 'Gastos y ganancias',
      intro: 'Lo que entra menos lo que sale: la ganancia real de la sucursal.',
      tips: [
        'Cargá acá lo que se paga por transferencia: <b>alquiler, sueldos, servicios, impuestos</b>.',
        'Los retiros de caja con categoría se suman solos.',
        'En <b>Sueldos</b> elegí a quién le pagaste: así ves el rendimiento de cada persona en Equipo.',
        'El <b>costo de lo vendido</b> se calcula con las recetas: lo sano en pizzería es entre 25% y 35% de lo que se vende.',
      ],
    },
    equipo: {
      title: 'Equipo',
      intro: 'Las personas de la sucursal y cómo rinde cada una.',
      tips: [
        '<b>Generar código</b> crea un enlace (y un QR) para que alguien se sume solo: elige su usuario y contraseña.',
        'También podés <b>crear el usuario</b> vos directamente.',
        'La tabla muestra cuánto cobró cada uno, las anulaciones, las diferencias en los cierres de caja y cuánto vende por cada $1 de sueldo.',
      ],
    },
    reportes: {
      title: 'Reportes',
      intro: 'Cómo le va a la sucursal: ventas por día, hora, producto y medio de pago.',
      tips: [
        'Elegí el período arriba. Las ventas viejas se traen de la nube automáticamente.',
        '<b>¿A qué hora se vende más?</b> te ayuda a organizar los turnos.',
        '<b>Exportar</b> descarga el detalle por producto para Excel.',
      ],
    },
    config: {
      title: 'Configuración',
      intro: 'Los datos de la sucursal que salen en el ticket, la impresora y los cobros.',
      tips: [
        '<b>Ticket e impresora</b>: elegí cómo imprimir (impresora del sistema, Bluetooth o la app RawBT), el ancho del papel y hacé una prueba.',
        '<b>Cobros</b>: cargá el alias y CBU para transferencias y la imagen del QR de Mercado Pago. Si conectás Mercado Pago, el QR sale con el monto y el cobro se registra solo.',
        '<b>Apariencia</b>: el "sabor" de colores se guarda en cada equipo.',
      ],
    },

    /* ---------- Panel del negocio ---------- */
    'n-resumen': {
      title: 'Resumen del negocio',
      intro: 'Todas tus sucursales de un vistazo, en vivo.',
      tips: [
        'Las alertas te avisan de diferencias de caja, faltantes de stock o sucursales que gastan más de lo que venden.',
        'Tocá <b>Operar</b> en una sucursal para vender o revisar algo ahí, sin cerrar sesión. Con 🏢 <b>Panel</b> volvés.',
        'Cambiá el período arriba para comparar semanas o meses.',
      ],
    },
    'n-sucursales': {
      title: 'Sucursales',
      intro: 'Creá sucursales y sumá a sus encargados.',
      tips: [
        'Al crear una sucursal se copia el menú modelo y la configuración que elijas.',
        '<b>Código para encargado</b> genera un enlace para que el encargado se sume solo a esa sucursal.',
        'Cada sucursal tiene sus propios datos: vos los ves todos, pero no se mezclan.',
      ],
    },
    'n-finanzas': {
      title: 'Finanzas',
      intro: 'La ganancia de cada sucursal y del negocio completo.',
      tips: [
        '<b>Ganancia</b> = todo lo cobrado − todos los gastos cargados.',
        'Compará el <b>margen</b> y el <b>food cost</b> entre sucursales para detectar la que anda mal.',
      ],
    },
    'n-equipo': {
      title: 'Equipo del negocio',
      intro: 'Todas las personas del negocio, su contacto y su rendimiento.',
      tips: [
        'Filtrá por sucursal para ver solo a su gente.',
        'Solo vos podés sumar <b>encargados</b>; los encargados suman cajeros, cocina y delivery.',
      ],
    },
    'n-menu': {
      title: 'Menú modelo',
      intro: 'El menú "oficial" del negocio.',
      tips: [
        'Editá el menú en una sucursal y después tocá <b>Usar el menú de una sucursal como modelo</b>.',
        '<b>Enviar el modelo</b> actualiza precios, agrega productos o reemplaza el menú en las sucursales que elijas.',
      ],
    },
    'n-config': { title: 'Negocio', intro: 'El nombre del negocio y los módulos de tu plan.', tips: ['Para sumar módulos o sucursales, hablá con el administrador del sistema.'] },

    /* ---------- Plataforma ---------- */
    'p-negocios': {
      title: 'Negocios',
      intro: 'Todos los negocios que usan el sistema.',
      tips: [
        '<b>Nuevo negocio</b>: elegís módulos y máximo de sucursales, y te da los datos para mandarle al dueño.',
        '<b>Entrar</b> te lleva al panel del negocio en modo soporte.',
        'Con ⚙️ suspendés un negocio o le generás una contraseña nueva al dueño.',
      ],
    },
    'p-errores': { title: 'Errores de la app', intro: 'Los errores que tuvo la app en los equipos de los clientes.', tips: ['Si algo se repite mucho, avisale al cliente antes de que te llame.'] },
  };

  const key = () => `pz-help-seen-${(PZ.auth.current && PZ.auth.current.id) || (PZ.auth.me && PZ.auth.me.id) || 'anon'}`;
  const seen = () => { try { return new Set(JSON.parse(localStorage.getItem(key()) || '[]')); } catch (e) { return new Set(); } };
  const markSeen = (id) => { const s = seen(); s.add(id); localStorage.setItem(key(), JSON.stringify([...s])); };

  PZ.help = {
    GUIDES,
    has: (id) => !!GUIDES[id],

    /** Consejo arriba de la pantalla, solo la primera vez */
    banner(el, id) {
      const g = GUIDES[id];
      if (!g || seen().has(id) || !el) return;
      const div = document.createElement('div');
      div.className = 'help-tip';
      div.innerHTML = `
        <span class="ht-ico">💡</span>
        <div class="ht-body"><b>${U.esc(g.title)}:</b> ${g.intro}${g.tips[0] ? `<div class="ht-first">${g.tips[0]}</div>` : ''}</div>
        <div class="ht-actions"><button class="btn sm ghost" data-a="more">Ver más</button><button class="btn sm primary" data-a="ok">Entendido</button></div>`;
      el.prepend(div);
      /** @type {HTMLElement} */ (div.querySelector('[data-a=ok]')).onclick = () => { markSeen(id); div.classList.add('bye'); setTimeout(() => div.remove(), 280); };
      /** @type {HTMLElement} */ (div.querySelector('[data-a=more]')).onclick = () => { markSeen(id); div.remove(); PZ.help.open(id); };
    },

    /** Guía completa de una pantalla */
    open(id) {
      const g = GUIDES[id];
      if (!g) return PZ.toast('No hay ayuda para esta pantalla todavía', 'info');
      PZ.modal({
        title: `❓ ${U.esc(g.title)}`,
        body: `<p style="margin-top:0">${g.intro}</p>
          <ol class="help-list">${g.tips.map((t) => `<li>${t}</li>`).join('')}</ol>
          <p class="small muted">Tocá ❓ arriba cuando quieras volver a ver esta guía.</p>`,
        footer: '<button class="btn ghost" data-a="reset">Volver a mostrar todos los consejos</button>',
        onOpen: (m, api) => {
          m.querySelector('[data-a=reset]').onclick = () => {
            localStorage.removeItem(key());
            api.close();
            PZ.toast('Los consejos van a volver a aparecer en cada pantalla');
            PZ.app.route();
          };
        },
      });
    },
  };
})(window.PZ);
