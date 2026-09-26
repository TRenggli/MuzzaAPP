/* ==========================================================================
   PZ.seed — configuración por defecto, menú de ejemplo y ventas de demo
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;

  PZ.seed = {
    settings(businessName = 'Mi Pizzería', branchName = '') {
      return {
        business: {
          name: businessName,
          slogan: 'Pizza a la piedra, con amor',
          address: '',
          city: '',
          phone: '',
          cuit: '',
          taxCondition: 'Monotributista',
          instagram: '',
          branchLabel: branchName,
        },
        ticket: {
          width: 80,
          showLogo: true,
          logo: null,
          qrMode: 'instagram',
          qrText: '',
          docTitle: 'Comprobante de pago',
          footer: '¡Gracias por elegirnos! Buen provecho',
          legend: 'Comprobante no válido como factura',
          pos: 1,
          copies: 1,
          autoPrint: true,
          printKitchen: true,
          printMode: 'browser',
          escposAccents: false,
        },
        payments: {
          alias: '', cbu: '', holder: '', bank: '', qrImage: null, qrLink: '',
          cashDiscountPct: 0, cardSurchargePct: 0, enableCard: true,
        },
        halfPricing: 'max',
        prepMinutes: 35,
        zones: [
          { id: 'z1', name: 'Zona 1 · hasta 10 cuadras', fee: 1500 },
          { id: 'z2', name: 'Zona 2 · hasta 20 cuadras', fee: 2500 },
          { id: 'z3', name: 'Zona 3 · más lejos', fee: 3500 },
        ],
        drivers: [],
        online: PZ.carta.defaults(),
      };
    },

    catalog() {
      const categories = [
        { id: 'c-piz', name: 'Pizzas', icon: '🍕', allowHalf: true },
        { id: 'c-esp', name: 'Especiales', icon: '⭐', allowHalf: true },
        { id: 'c-emp', name: 'Empanadas', icon: '🥟', allowHalf: false },
        { id: 'c-fai', name: 'Fainá y más', icon: '🥧', allowHalf: false },
        { id: 'c-beb', name: 'Bebidas', icon: '🥤', allowHalf: false },
        { id: 'c-pos', name: 'Postres', icon: '🍮', allowHalf: false },
      ];
      const base = [{ ingredientId: 'i-muz', qty: 0.35 }, { ingredientId: 'i-har', qty: 0.3 }, { ingredientId: 'i-sal', qty: 0.15 }, { ingredientId: 'i-car', qty: 1 }];
      const withX = (extra) => base.concat(extra);
      const pz = (categoryId, name, desc, chica, grande, recipe, color) => ({
        id: U.uid('p-'), categoryId, name, desc, active: true, color, recipe,
        variants: [
          { id: 'grande', name: 'Grande', price: grande, factor: 1 },
          { id: 'chica', name: 'Chica', price: chica, factor: 0.6 },
        ],
      });
      const one = (categoryId, name, desc, price, extra = {}) => ({
        id: U.uid('p-'), categoryId, name, desc, active: true,
        variants: [{ id: 'u', name: 'Unidad', price, factor: 1 }], recipe: [], ...extra,
      });
      const emp = (name, desc) => ({
        id: U.uid('p-'), categoryId: 'c-emp', name, desc, active: true, recipe: [],
        variants: [{ id: 'u', name: 'Unidad', price: 1500, factor: 1 }, { id: 'doc', name: 'Docena', price: 16000, factor: 12 }],
      });
      const products = [
        pz('c-piz', 'Muzzarella', 'Salsa, muzzarella, orégano y aceitunas', 9500, 13500, withX([{ ingredientId: 'i-ace', qty: 0.02 }]), '#f4d35e'),
        pz('c-piz', 'Napolitana', 'Muzza, rodajas de tomate, ajo y perejil', 10500, 15000, base, '#e63946'),
        pz('c-piz', 'Fugazzeta', 'Rellena de muzza con cebolla y orégano', 11000, 15800, withX([{ ingredientId: 'i-ceb', qty: 0.25 }, { ingredientId: 'i-muz', qty: 0.15 }]), '#e9c46a'),
        pz('c-piz', 'Calabresa', 'Muzza con longaniza calabresa', 11000, 16000, withX([{ ingredientId: 'i-cal', qty: 0.12 }]), '#b3261e'),
        pz('c-piz', 'Especial', 'Muzza, jamón, morrones y huevo', 11500, 16500, withX([{ ingredientId: 'i-jam', qty: 0.12 }]), '#f4a261'),
        pz('c-piz', 'Jamón y morrones', 'Muzza, jamón cocido y morrones asados', 11000, 16000, withX([{ ingredientId: 'i-jam', qty: 0.12 }]), '#d62828'),
        pz('c-piz', 'Cuatro quesos', 'Muzza, roquefort, provolone y parmesano', 12500, 17800, withX([{ ingredientId: 'i-muz', qty: 0.1 }]), '#ffe08a'),
        pz('c-piz', 'Rúcula y crudo', 'Muzza, rúcula fresca, jamón crudo y parmesano', 13500, 19000, withX([{ ingredientId: 'i-cru', qty: 0.1 }]), '#52b788'),
        pz('c-esp', 'Provolone y tomate', 'Provolone gratinado, tomate y albahaca', 12500, 18000, base, '#e76f51'),
        pz('c-esp', 'Palmitos', 'Muzza, jamón, palmitos y salsa golf', 13000, 18500, base, '#90be6d'),
        pz('c-esp', 'Pizza de la casa', 'Muzza, panceta, cheddar y verdeo', 13500, 19500, base, '#ff8c42'),
        emp('Empanada de carne', 'Cortada a cuchillo, al horno'),
        emp('Empanada jamón y queso', 'Clásica'),
        emp('Empanada de humita', 'Choclo cremoso'),
        one('c-fai', 'Fainá', 'Porción de fainá de garbanzos', 1800, { recipe: [{ ingredientId: 'i-gar', qty: 0.05 }] }),
        one('c-fai', 'Fugazza', 'Sin queso, cebolla y orégano', 9000),
        one('c-fai', 'Calzone', 'Jamón, muzza y tomate', 11500),
        one('c-beb', 'Coca-Cola 1.5L', '', 4200),
        one('c-beb', 'Sprite 1.5L', '', 4000),
        one('c-beb', 'Agua 500ml', '', 1800),
        one('c-beb', 'Cerveza Quilmes 1L', '', 4500),
        one('c-beb', 'Cerveza artesanal IPA', 'Pinta', 5000),
        one('c-pos', 'Flan casero', 'Con dulce de leche', 4000),
        one('c-pos', 'Helado 1/4 kg', '', 6000),
      ];
      const extras = [
        { id: 'e1', name: 'Extra muzzarella', price: 2500 },
        { id: 'e2', name: 'Huevo', price: 1000 },
        { id: 'e3', name: 'Aceitunas extra', price: 800 },
        { id: 'e4', name: 'Morrones', price: 1500 },
        { id: 'e5', name: 'Borde relleno', price: 3000 },
        { id: 'e6', name: 'Sin sal / sin orégano', price: 0 },
      ];
      return { categories, products, extras };
    },

    customers() {
      return [
        { id: U.uid('cl-'), name: 'María González', phone: '11 4455-6677', address: 'Mitre 1234, 2°B', zoneId: 'z1', notes: 'Timbre no anda, llamar', createdAt: Date.now() - 40 * 864e5 },
        { id: U.uid('cl-'), name: 'Juan Pérez', phone: '11 3322-1100', address: 'Belgrano 560', zoneId: 'z2', notes: '', createdAt: Date.now() - 30 * 864e5 },
        { id: U.uid('cl-'), name: 'Lucía Fernández', phone: '11 6789-0123', address: 'San Martín 88', zoneId: 'z1', notes: 'Siempre pide fugazzeta', createdAt: Date.now() - 20 * 864e5 },
        { id: U.uid('cl-'), name: 'Club El Fortín', phone: '11 2233-4455', address: 'Rivadavia 3000', zoneId: 'z3', notes: 'Pedidos grandes los viernes', createdAt: Date.now() - 12 * 864e5 },
      ];
    },

    ingredients(withStock = true) {
      const k = withStock ? 1 : 0;
      return [
        { id: 'i-muz', name: 'Muzzarella', unit: 'kg', stock: 18 * k, min: 5, cost: 9500 },
        { id: 'i-har', name: 'Harina 000', unit: 'kg', stock: 40 * k, min: 10, cost: 900 },
        { id: 'i-sal', name: 'Salsa de tomate', unit: 'lt', stock: 12 * k, min: 4, cost: 2200 },
        { id: 'i-jam', name: 'Jamón cocido', unit: 'kg', stock: 4 * k, min: 1.5, cost: 11000 },
        { id: 'i-ceb', name: 'Cebolla', unit: 'kg', stock: 6 * k, min: 2, cost: 1200 },
        { id: 'i-cal', name: 'Longaniza calabresa', unit: 'kg', stock: 2.5 * k, min: 1, cost: 13000 },
        { id: 'i-ace', name: 'Aceitunas', unit: 'kg', stock: 1.2 * k, min: 0.5, cost: 8000 },
        { id: 'i-cru', name: 'Jamón crudo', unit: 'kg', stock: 0.8 * k, min: 1, cost: 26000 },
        { id: 'i-car', name: 'Cajas de pizza', unit: 'u', stock: 180 * k, min: 60, cost: 450 },
        { id: 'i-gar', name: 'Garbanzos (fainá)', unit: 'kg', stock: 5 * k, min: 1.5, cost: 2800 },
      ];
    },

    /**
     * Genera `days` días de ventas ficticias en la sucursal actual.
     * Los números se reservan en la base para no chocar con ventas reales.
     */
    async demoHistory(days = 14, scale = 1) {
      const S = PZ.store;
      const d = S.data;
      const pizzas = d.products.filter((p) => { const c = S.category(p.categoryId); return c && c.allowHalf; });
      const others = d.products.filter((p) => !pizzas.includes(p));
      if (!pizzas.length) throw new Error('Primero cargá el menú');
      const methods = ['efectivo', 'efectivo', 'transferencia', 'transferencia', 'qr', 'qr', 'tarjeta'];
      const types = ['mostrador', 'delivery', 'delivery', 'retiro', 'mesa'];
      const drivers = d.settings.drivers.length ? d.settings.drivers : ['Carlos', 'Lucas'];
      const rnd = (a) => a[Math.floor(Math.random() * a.length)];
      const today = U.startOfDay();
      const plan = [];
      for (let day = days; day >= 1; day--) {
        const dayStart = new Date(today.getTime() - day * 864e5);
        const dow = dayStart.getDay();
        plan.push({ dayStart, n: Math.round((dow === 5 || dow === 6 ? 34 : dow === 0 ? 28 : 18) * (0.8 + Math.random() * 0.4) * scale) });
      }
      const total = plan.reduce((a, p) => a + p.n, 0);
      // La base reserva de a 500 como máximo: se piden tandas
      const reserveMany = async (kind) => {
        const nums = [];
        for (let left = total; left > 0; left -= 400) {
          const n = Math.min(400, left);
          const start = await PZ.cloud.reserve(S.ctx.branchId, kind, n);
          for (let i = 0; i < n; i++) nums.push(start + i);
        }
        return nums;
      };
      const orderNums = await reserveMany('order');
      const ticketNums = await reserveMany('ticket');
      let k = 0;
      const uid = PZ.auth.current ? PZ.auth.current.id : null;
      // Las ventas se reparten entre quienes cobran en la sucursal
      const bid = S.ctx.branchId;
      const staff = S.ctx.members.filter((m) => m.active && ['owner', 'admin', 'cajero'].includes(m.role) && (m.role === 'owner' || !(m.branch_ids || []).length || m.branch_ids.includes(bid)));
      const cashiers = staff.filter((m) => m.role !== 'owner');
      const pickSeller = () => (cashiers.length && Math.random() < 0.85 ? rnd(cashiers) : rnd(staff.length ? staff : [{ user_id: uid }])).user_id;
      const payroll = S.ctx.members.filter((m) => m.active && m.role !== 'owner' && ((m.branch_ids || []).includes(bid)));
      const exp = (at, category, amount, description, extra = {}) => d.expenses.push({
        id: U.uid('gx-'), at, category, amount: Math.round(amount / 100) * 100, description, method: 'transferencia', supplier: '',
        employeeId: '', source: 'manual', cashMoveId: '', userId: uid, demo: true, ...extra,
      });
      let bucketSales = 0;
      let digital = 0;
      plan.forEach(({ dayStart, n }) => {
        const session = {
          id: U.uid('cs-'), openedAt: dayStart.getTime() + 18.5 * 36e5, openedBy: uid, openingAmount: 20000,
          closedAt: null, closedBy: uid, countedCash: 0, expectedCash: 0, diff: 0, notes: '', demo: true,
        };
        let cashIn = 0;
        let daySales = 0;
        for (let i = 0; i < n; i++, k++) {
          const hour = Math.random() < 0.15 ? 12 + Math.random() * 2 : 19.5 + Math.random() * 4;
          const at = Math.round(dayStart.getTime() + hour * 36e5);
          const items = [];
          const np = 1 + Math.floor(Math.random() * 2.4);
          for (let j = 0; j < np; j++) {
            const p = rnd(pizzas);
            const v = Math.random() < 0.8 ? p.variants[0] : p.variants[p.variants.length - 1];
            if (Math.random() < 0.18) {
              const p2 = rnd(pizzas);
              const v2 = p2.variants.find((x) => x.id === v.id) || p2.variants[0];
              items.push(S.makeItem({ product: p, variant: v, half: { product: p2, variant: v2 }, qty: 1 }));
            } else items.push(S.makeItem({ product: p, variant: v, qty: 1 }));
          }
          if (others.length && Math.random() < 0.6) { const o = rnd(others); items.push(S.makeItem({ product: o, variant: o.variants[0], qty: 1 + Math.floor(Math.random() * 2) })); }
          const type = rnd(types);
          const zone = type === 'delivery' && d.settings.zones.length ? rnd(d.settings.zones) : null;
          const cust = d.customers.length && (type === 'delivery' || Math.random() < 0.3) ? rnd(d.customers) : null;
          const subtotal = items.reduce((a, it) => a + it.total, 0);
          const tot = subtotal + (zone ? zone.fee : 0);
          const method = rnd(methods);
          const tendered = method === 'efectivo' ? Math.ceil(tot / 5000) * 5000 : tot;
          if (method === 'efectivo') cashIn += tot;
          if (method === 'qr' || method === 'tarjeta') digital += tot;
          daySales += tot;
          const seller = pickSeller();
          d.orders.push({
            id: U.uid('o-'), number: orderNums[k], ticketNumber: ticketNums[k],
            createdAt: at, paidAt: at + 60000, userId: seller, paidBy: seller, type,
            table: type === 'mesa' ? String(1 + Math.floor(Math.random() * 12)) : '',
            customerId: cust ? cust.id : null, customerName: cust ? cust.name : '', phone: cust ? cust.phone : '', address: cust && type === 'delivery' ? cust.address : '',
            zoneId: zone ? zone.id : null, items, subtotal, discountAmount: 0, discount: null, surcharge: 0, cashDiscount: 0,
            deliveryFee: zone ? zone.fee : 0, total: tot,
            payments: [{ method, amount: tot, tendered, change: tendered - tot, ref: '' }],
            paid: true, status: 'entregado', statusTimes: { pendiente: at, entregado: at + 40 * 60000 },
            driver: type === 'delivery' ? rnd(drivers) : '', cashSessionId: session.id, notes: '', voided: false, demo: true,
          });
        }
        session.closedAt = dayStart.getTime() + 24 * 36e5 - 60000;
        session.expectedCash = session.openingAmount + cashIn - 5000;
        const diff = Math.random() < 0.7 ? 0 : Math.round((Math.random() * 2000 - 1000) / 100) * 100;
        session.countedCash = session.expectedCash + diff;
        session.diff = diff;
        d.cashSessions.push(session);
        session.openedBy = session.closedBy = pickSeller();
        const cm = { id: U.uid('cm-'), sessionId: session.id, type: 'egreso', amount: 5000, reason: 'Compra de verdura', category: 'Mercadería', at: session.openedAt + 36e5, userId: uid, demo: true };
        d.cashMoves.push(cm);
        exp(cm.at, 'Mercadería', 5000, 'Compra de verdura', { method: 'efectivo', source: 'caja', cashMoveId: cm.id });

        // Gastos de ejemplo: mercadería cada 2 días, sueldos y comisiones semanales, alquiler y servicios
        bucketSales += daySales;
        const di = plan.findIndex((x) => x.dayStart === dayStart);
        const noon = dayStart.getTime() + 11 * 36e5;
        if (di % 2 === 1) { exp(noon, 'Mercadería', bucketSales * (0.28 + Math.random() * 0.06), rnd(['Muzzarella y fiambres', 'Harina, salsa y verdura', 'Bebidas', 'Cajas y descartables']), { supplier: rnd(['La Serenísima', 'Distribuidora Norte', 'Mayorista Oeste']) }); bucketSales = 0; }
        if (dayStart.getDay() === 5) {
          if (payroll.length) payroll.forEach((m) => exp(noon + 36e5, 'Sueldos', (m.role === 'admin' ? 260000 : 180000) * scale, 'Semana de ' + m.name, { employeeId: m.user_id }));
          else exp(noon + 36e5, 'Sueldos', 360000 * scale, 'Sueldos de la semana');
          exp(noon + 2 * 36e5, 'Comisiones', digital * 0.045, 'Comisiones Mercado Pago y posnet');
          digital = 0;
        }
        if (di === 0) {
          exp(noon, 'Alquiler', 900000 * scale, 'Alquiler del local');
          exp(noon + 36e5, 'Servicios', 140000 * scale, 'Luz y gas');
        }
        if (di === 7) exp(noon, 'Delivery', 60000 * scale, 'Nafta de las motos');
      });
      d.orders.sort((a, b) => a.createdAt - b.createdAt);
      d.expenses.sort((a, b) => b.at - a.at);
      d.cashSessions.sort((a, b) => a.openedAt - b.openedAt);
      d.demo = true;
      S.save();
      return total;
    },
  };
})(window.PZ);
