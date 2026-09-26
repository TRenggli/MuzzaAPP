// @ts-check
/* ==========================================================================
   PZ.mp — cobro con QR de Mercado Pago (monto automático)
     · la caja genera un QR con el monto exacto de la venta
     · el cliente lo escanea con la app de Mercado Pago (o cualquier billetera)
     · el sistema consulta el pago y lo registra solo, sin "¿verificaste?"
   El Access Token del negocio queda guardado en el servidor (función "mp").
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;
  const POLL_MS = 2500;

  const M = (PZ.mp = {
    state: { loaded: false, connected: false, branchReady: false, nickname: '', canManage: false, canSetup: false },

    enabled: () => PZ.auth.feature('mercadopago'),
    /** Listo para cobrar en esta sucursal */
    ready: () => M.enabled() && M.state.connected && M.state.branchReady && navigator.onLine,

    async load() {
      M.state = { ...M.state, loaded: false, connected: false, branchReady: false };
      if (!M.enabled() || !navigator.onLine) return M.state;
      try { M.state = { ...(await PZ.cloud.mp('account')), loaded: true }; } catch (e) { console.warn('mercado pago', e); }
      return M.state;
    },

    async connect(token) { await PZ.cloud.mp('connect', { access_token: token }); return M.load(); },
    async disconnect() { await PZ.cloud.mp('disconnect'); return M.load(); },
    async setup(location) { await PZ.cloud.mp('setup_branch', { location }); return M.load(); },

    /**
     * Muestra el QR con el monto y espera el pago.
     * Devuelve { order, payment } si se pagó, o null si se canceló.
     */
    charge(amount, description = '') {
      return new Promise((resolve) => {
        /** @type {{ id: string, qr_data: string, minutes?: number } | null} */
        let current = null;
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        /** @type {ReturnType<typeof setInterval> | undefined} */
        let tick;
        let finished = false;
        const reference = U.uid('pz-').replace(/[^A-Za-z0-9_-]/g, '');

        const m = PZ.modal({
          title: '📱 Cobro con QR de Mercado Pago',
          size: 'sm',
          dismissable: false,
          body: `<div class="mp-qr">
              <span class="mp-badge">Mercado Pago</span>
              <div class="mp-amount">${U.money(amount)}</div>
              <div class="qr-frame"><div style="aspect-ratio:1;display:grid;place-items:center" class="muted">Generando QR…</div></div>
              <div class="mp-state"><i></i><span>Preparando…</span></div>
              <div class="small muted mp-hint">El cliente lo escanea con la app de Mercado Pago o de su banco.</div>
            </div>`,
          footer: '<button class="btn ghost" data-a="x">Cancelar cobro</button><button class="btn primary hidden" data-a="again">🔄 Generar otro QR</button>',
        });
        const E = m.el;
        const setState = (txt, done = false) => {
          E.querySelector('.mp-state span').textContent = txt;
          E.querySelector('.mp-state i').style.display = done ? 'none' : '';
        };
        const stop = () => { clearTimeout(timer); clearInterval(tick); };
        const finish = (res) => {
          if (finished) return;
          finished = true;
          stop();
          m.close();
          resolve(res);
        };

        const paid = (st) => {
          stop();
          E.querySelector('.qr-frame').classList.add('done');
          setState('¡Pago acreditado!', true);
          PZ.beep([988, 1319]);
          if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
          const order = current ? current.id : '';
          setTimeout(() => finish({ order, payment: st.payment_id || '' }), 900);
        };

        const poll = async () => {
          if (finished || !current) return;
          try {
            const st = await PZ.cloud.mp('status', { id: current.id });
            if (st.state === 'paid') return paid(st);
            if (st.state === 'expired' || st.state === 'canceled' || st.state === 'failed') {
              stop();
              setState(st.state === 'expired' ? 'El QR venció sin pago' : 'El cobro no se completó', true);
              E.querySelector('[data-a=again]').classList.remove('hidden');
              return;
            }
          } catch (e) { /* corte de internet: se reintenta */ }
          timer = setTimeout(poll, POLL_MS);
        };

        const create = async () => {
          stop();
          E.querySelector('[data-a=again]').classList.add('hidden');
          E.querySelector('.qr-frame').classList.remove('done');
          setState('Generando QR…');
          try {
            const c = await PZ.cloud.mp('create', { amount, reference: `${reference}-${Date.now().toString(36)}`, description });
            if (!c.qr_data) throw new Error('Mercado Pago no devolvió el QR');
            current = c;
            E.querySelector('.qr-frame').innerHTML = U.qrSvg(c.qr_data, 6, 1);
            const until = Date.now() + (c.minutes || 10) * 60000;
            const count = () => {
              const s = Math.max(0, Math.round((until - Date.now()) / 1000));
              setState(`Esperando el pago… (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`);
            };
            count();
            tick = setInterval(count, 1000);
            timer = setTimeout(poll, POLL_MS);
          } catch (e) {
            setState(e.message || 'No se pudo generar el QR', true);
            E.querySelector('[data-a=again]').classList.remove('hidden');
          }
        };

        E.querySelector('[data-a=again]').onclick = create;
        E.querySelector('[data-a=x]').onclick = async () => {
          if (!current) return finish(null);
          // Se anula en Mercado Pago para que el cliente no pueda pagar un QR que la caja ya no espera
          stop();
          setState('Anulando el QR…');
          try {
            const st = await PZ.cloud.mp('cancel', { id: current.id });
            if (st.state === 'paid') { PZ.toast('¡El cliente ya había pagado! Se registra el cobro.', 'ok', 5000); return paid(st); }
          } catch (e) {
            if (!(await PZ.confirm(`No se pudo anular el QR en Mercado Pago (${U.esc(e.message)}). Si el cliente lo paga igual, vas a ver el pago en la app de Mercado Pago. ¿Cerrar igual?`))) { timer = setTimeout(poll, 0); return; }
          }
          finish(null);
        };
        create();
      });
    },
  });
})(window.PZ);
