// @ts-check
/* ==========================================================================
   Vista: CAJA — apertura, movimientos, arqueo y cierre (Z)
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const S = PZ.store;
  const BILLS = [20000, 10000, 2000, 1000, 500, 200, 100];

  PZ.cash = {
    /** Si la caja está cerrada, ofrece abrirla. Devuelve true si queda abierta. */
    async ensureOpen() {
      if (S.currentSession()) return true;
      return new Promise((resolve) => {
        let done = false;
        const m = PZ.modal({
          title: '💰 La caja está cerrada',
          size: 'sm',
          body: `<p style="margin-top:0">Para cobrar hay que abrir la caja. ¿Con cuánto efectivo arrancás (fondo para vuelto)?</p>
                 <label class="field"><span>Fondo inicial</span><input class="amt" inputmode="numeric" value="0" autofocus></label>`,
          footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Abrir caja</button>`,
          onClose: () => { if (!done) resolve(false); },
        });
        m.el.querySelector('[data-a=x]').onclick = () => m.close();
        m.el.querySelector('[data-a=ok]').onclick = () => {
          S.openSession(U.parseMoney(m.el.querySelector('.amt').value));
          done = true;
          m.close();
          PZ.toast('Caja abierta. ¡Buen servicio!');
          resolve(true);
        };
      });
    },
  };

  function render(el) {
    const s = S.currentSession();
    if (!s) return renderClosed(el);
    const sum = S.sessionSummary(s);
    const L = PZ.labels;
    const C = PZ.charts;
    const opener = S.user(s.openedBy);
    el.innerHTML = `
      <div class="row-flex space-between mb">
        <div><span class="badge ok">● Abierta</span> <span class="muted small">desde ${U.dateTime(s.openedAt)} por ${U.esc(opener ? opener.name : '-')}</span></div>
        <div class="row-flex">
          <button class="btn ghost" data-a="in">➕ Ingreso</button>
          <button class="btn ghost" data-a="out">➖ Retiro / gasto</button>
          <button class="btn ghost" data-a="partial">🖨️ Arqueo parcial</button>
          <button class="btn primary" data-a="close">🔒 Cerrar caja</button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="k-ico">💰</span><div class="k-label">Ventas del turno</div><div class="k-value">${U.money(sum.sales)}</div><div class="k-sub">${sum.tickets} tickets · promedio ${U.money(sum.avg)}</div></div>
        <div class="kpi"><span class="k-ico">💵</span><div class="k-label">Efectivo que debería haber</div><div class="k-value">${U.money(sum.expectedCash)}</div><div class="k-sub">Fondo ${U.money(s.openingAmount)} + ventas − retiros</div></div>
        <div class="kpi"><span class="k-ico">🏦</span><div class="k-label">Digital (transf. + QR + tarjeta)</div><div class="k-value">${U.money(sum.byMethod.transferencia + sum.byMethod.qr + sum.byMethod.tarjeta)}</div><div class="k-sub">Revisá que coincida con tu cuenta</div></div>
        <div class="kpi"><span class="k-ico">↕️</span><div class="k-label">Movimientos</div><div class="k-value">${U.money(sum.ingresos - sum.egresos)}</div><div class="k-sub">+${U.money(sum.ingresos)} / −${U.money(sum.egresos)}</div></div>
      </div>
      <div class="dash">
        <div class="card"><h3>📊 Por medio de pago</h3>
          ${C.donut(Object.keys(L.method).map((k) => ({ label: L.method[k], value: sum.byMethod[k] || 0, color: C.methodColors[k] })).filter((d) => d.value))}
        </div>
        <div class="card"><h3>↕️ Ingresos y retiros</h3>
          ${sum.moves.length ? sum.moves.slice().reverse().map((mv) => `<div class="list-row"><span>${mv.type === 'egreso' ? '➖' : '➕'}</span><div class="grow"><b>${U.esc(mv.reason || '-')}</b><div class="small muted">${U.time(mv.at)} · ${U.esc((S.user(mv.userId) || {}).name || '')}</div></div><b style="color:${mv.type === 'egreso' ? 'var(--err)' : 'var(--ok)'}">${mv.type === 'egreso' ? '−' : '+'}${U.money(mv.amount)}</b></div>`).join('') : '<div class="empty small">Sin movimientos</div>'}
        </div>
      </div>
      <div class="card mt"><h3>🧾 Ventas del turno</h3>${ordersTable(sum.orders.slice().reverse())}</div>
      <div class="card mt"><h3>📚 Cierres anteriores</h3>${historyTable()}</div>`;

    const on = (a, fn) => { el.querySelector(`[data-a=${a}]`).onclick = fn; };
    on('in', () => moveModal('ingreso', () => render(el)));
    on('out', () => moveModal('egreso', () => render(el)));
    on('partial', () => PZ.ticket.printClose(s));
    on('close', () => closeModal(() => render(el)));
    bindTables(el);
  }

  function ordersTable(list) {
    if (!list.length) return '<div class="empty small">Todavía no hay ventas en este turno</div>';
    const L = PZ.labels;
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Hora</th><th>Nº</th><th>Tipo</th><th>Pago</th><th class="right">Total</th><th></th></tr></thead><tbody>
      ${list.map((o) => `<tr><td>${U.time(o.paidAt)}</td><td>#${o.number}</td><td>${L.typeIcon[o.type]} ${L.type[o.type]}</td>
        <td>${o.payments.map((p) => L.methodIcon[p.method]).join(' ')}</td><td class="right"><b>${U.money(o.total)}</b></td>
        <td class="actions"><button class="btn sm ghost" data-view="${o.id}">🧾</button></td></tr>`).join('')}
    </tbody></table></div>`;
  }

  function historyTable() {
    const list = S.data.cashSessions.filter((s) => s.closedAt).slice().reverse().slice(0, 30);
    if (!list.length) return '<div class="empty small">Sin cierres todavía</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th class="right">Ventas</th><th class="right">Esperado</th><th class="right">Contado</th><th class="right">Diferencia</th><th></th></tr></thead><tbody>
      ${list.map((s) => {
        const sum = S.sessionSummary(s);
        return `<tr><td>${U.date(s.openedAt)} <span class="muted small">${U.time(s.openedAt)}–${U.time(s.closedAt)}</span></td><td class="right">${U.money(sum.sales)}</td>
        <td class="right">${U.money(s.expectedCash)}</td><td class="right">${U.money(s.countedCash)}</td>
        <td class="right"><span class="badge ${s.diff === 0 ? 'ok' : s.diff > 0 ? 'warn' : 'err'}">${s.diff === 0 ? 'OK' : (s.diff > 0 ? '+' : '−') + U.money(Math.abs(s.diff))}</span></td>
        <td class="actions"><button class="btn sm ghost" data-z="${s.id}">🖨️ Z</button></td></tr>`;
      }).join('')}
    </tbody></table></div>`;
  }

  function bindTables(el) {
    el.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => PZ.ticket.preview(S.order(b.dataset.view)));
    el.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => PZ.ticket.printClose(S.data.cashSessions.find((s) => s.id === b.dataset.z)));
  }

  function renderClosed(el) {
    el.innerHTML = `
      <div class="hero">
        <div class="hero-pizza">${PZ.brandLogo(220)}</div>
        <h1>La caja está cerrada</h1>
        <p>Abrila al empezar el turno con el efectivo que tenés para dar vuelto.</p>
        <div class="row-flex" style="max-width:420px">
          <input class="amt grow" inputmode="numeric" placeholder="Fondo inicial, ej: 20000" style="background:#fff;color:#222;border:0">
          <button class="btn lg" data-a="open">🔓 Abrir caja</button>
        </div>
      </div>
      <div class="card"><h3>📚 Cierres anteriores</h3>${historyTable()}</div>`;
    el.querySelector('[data-a=open]').onclick = () => {
      S.openSession(U.parseMoney(el.querySelector('.amt').value));
      PZ.toast('Caja abierta. ¡Buen servicio!');
      render(el);
    };
    bindTables(el);
  }

  function moveModal(type, done) {
    const m = PZ.modal({
      title: type === 'ingreso' ? '➕ Ingreso de efectivo' : '➖ Retiro / gasto',
      size: 'sm',
      body: `<label class="field"><span>Monto</span><input class="amt" inputmode="numeric" autofocus></label>
             <label class="field"><span>Motivo</span><input class="reason" placeholder="${type === 'ingreso' ? 'Ej: cambio traído del banco' : 'Ej: pago al proveedor de queso'}" list="reasons"></label>
             <datalist id="reasons">${(type === 'egreso' ? ['Compra de mercadería', 'Pago a proveedor', 'Pago a repartidor', 'Retiro del dueño', 'Gas / servicios'] : ['Cambio para vuelto', 'Ajuste']).map((r) => `<option>${r}</option>`).join('')}</datalist>
             ${type === 'egreso' ? `<label class="field"><span>¿Es un gasto del negocio?</span><select class="cat"><option value="">No, es un retiro (ej: se lo lleva el dueño)</option>${S.EXPENSE_CATEGORIES.map((c) => `<option ${c === 'Mercadería' ? 'selected' : ''}>${c}</option>`).join('')}</select></label>` : ''}`,
      footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Registrar</button>`,
    });
    m.el.querySelector('[data-a=x]').onclick = () => m.close();
    m.el.querySelector('[data-a=ok]').onclick = () => {
      const amt = U.parseMoney(m.el.querySelector('.amt').value);
      if (!amt) return PZ.toast('Ingresá un monto', 'warn');
      const cat = m.el.querySelector('.cat');
      S.addCashMove(type, amt, m.el.querySelector('.reason').value.trim(), cat && PZ.auth.feature('gastos') ? cat.value : '');
      m.close();
      PZ.toast('Movimiento registrado');
      done();
    };
  }

  function closeModal(done) {
    const s = S.currentSession();
    const sum = S.sessionSummary(s);
    const m = PZ.modal({
      title: '🔒 Cierre de caja',
      body: `
        <p style="margin-top:0">Contá el efectivo del cajón. Podés cargar billete por billete o el total directo.</p>
        <div class="grid-3">${BILLS.map((b) => `<label class="field"><span>Billetes de ${U.money(b)}</span><input data-b="${b}" inputmode="numeric" placeholder="0"></label>`).join('')}
          <label class="field"><span>Monedas / otros</span><input data-b="1" inputmode="numeric" placeholder="0"></label></div>
        <label class="field"><span>Total contado</span><input class="counted" inputmode="numeric"></label>
        <div class="bank-box">
          <div class="bk-row"><span>Efectivo esperado</span><b>${U.money(sum.expectedCash)}</b></div>
          <div class="bk-row"><span>Contado</span><b class="c-counted">${U.money(0)}</b></div>
          <div class="bk-row"><span class="c-lbl">Diferencia</span><b class="c-diff">—</b></div>
        </div>
        <label class="field mt"><span>Observaciones</span><input class="notes" placeholder="Opcional"></label>`,
      footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Cerrar e imprimir Z</button>`,
    });
    const E = m.el;
    const counted = E.querySelector('.counted');
    const upd = () => {
      const v = U.parseMoney(counted.value);
      const diff = v - sum.expectedCash;
      E.querySelector('.c-counted').textContent = U.money(v);
      E.querySelector('.c-diff').textContent = counted.value ? (diff === 0 ? '✅ Justo' : (diff > 0 ? 'Sobran ' : 'Faltan ') + U.money(Math.abs(diff))) : '—';
      E.querySelector('.c-diff').style.color = !counted.value || diff === 0 ? 'var(--ok)' : 'var(--err)';
    };
    E.querySelectorAll('[data-b]').forEach((inp) => inp.addEventListener('input', () => {
      let t = 0;
      E.querySelectorAll('[data-b]').forEach((i) => { t += Number(i.dataset.b) * U.parseMoney(i.value); });
      counted.value = t;
      upd();
    }));
    counted.addEventListener('input', upd);
    E.querySelector('[data-a=x]').onclick = () => m.close();
    E.querySelector('[data-a=ok]').onclick = async () => {
      if (!counted.value) return PZ.toast('Cargá el efectivo contado', 'warn');
      const pending = S.data.orders.filter((o) => !o.voided && !o.paid).length;
      if (pending && !(await PZ.confirm(`Hay ${pending} pedido(s) sin cobrar. ¿Cerrar la caja igual?`))) return;
      const closed = S.closeSession(U.parseMoney(counted.value), E.querySelector('.notes').value.trim());
      m.close();
      PZ.toast('Caja cerrada');
      PZ.ticket.printClose(closed);
      done();
    };
  }

  PZ.views.caja = { title: 'Caja', live: true, render };
})(window.PZ);
