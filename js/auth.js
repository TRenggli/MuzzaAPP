/* ==========================================================================
   PZ.auth — sesión, niveles (plataforma / negocio / sucursal), roles,
   permisos y módulos contratados por cada negocio
   ========================================================================== */
(function (PZ) {
  const U = PZ.util;

  const ROLES = {
    owner: { label: 'Dueño/a' },
    admin: { label: 'Encargado/a' },
    cajero: { label: 'Cajero/a' },
    cocina: { label: 'Cocina' },
    delivery: { label: 'Delivery' },
  };

  // Qué puede usar cada rol DENTRO de una sucursal
  const BRANCH_ACCESS = {
    owner: '*',
    admin: '*',
    cajero: ['inicio', 'vender', 'pedidos', 'caja', 'clientes', 'historial', 'stock'],
    cocina: ['pedidos'],
    delivery: ['pedidos'],
  };

  // Secciones que dependen de un módulo contratado
  const FEATURE_OF = { stock: 'stock', gastos: 'gastos', online: 'carta' };

  const A = (PZ.auth = {
    ROLES,
    current: null,     // { id, name, username, role, branchIds, orgId }
    memberships: [],
    platform: false,   // es el administrador de la plataforma
    me: null,          // usuario de Supabase

    /** Arma el usuario actual para un negocio */
    use(member) {
      A.current = {
        id: member.user_id,
        name: member.name,
        username: member.username,
        role: member.role,
        branchIds: member.branch_ids || [],
        orgId: member.org_id,
        support: !!member.support,
      };
      return A.current;
    },

    /** La plataforma entra a un negocio como si fuera el dueño (soporte) */
    useSupport(org) {
      const meta = (A.me && A.me.user_metadata) || {};
      return A.use({ user_id: A.me.id, name: meta.name || 'Soporte', username: 'soporte', role: 'owner', branch_ids: [], org_id: org.id, support: true });
    },

    async login(user, password) {
      const session = await PZ.cloud.signIn(user, password);
      A.me = session.user;
      A.platform = await PZ.cloud.isPlatformAdmin();
      A.memberships = await PZ.cloud.memberships();
      if (!A.platform && !A.memberships.length) {
        await PZ.cloud.signOut();
        throw new Error('Tu usuario no tiene acceso a ningún negocio activo. Hablá con el dueño o con el administrador del sistema.');
      }
      return A.memberships;
    },

    async logout() {
      A.current = null;
      A.memberships = [];
      A.platform = false;
      A.me = null;
      await PZ.cloud.signOut();
    },

    /** Módulo habilitado para el negocio actual */
    feature(name) {
      const org = PZ.store.ctx.org;
      const f = (org && org.features) || {};
      return f[name] !== false;
    },

    /** ¿Puede entrar a esta sección de la sucursal? */
    can(section) {
      if (!A.current) return false;
      if (FEATURE_OF[section] && !A.feature(FEATURE_OF[section])) return false;
      if (['gastos', 'equipo', 'menu', 'online', 'reportes', 'config'].includes(section)) return A.isAdmin();
      const acc = BRANCH_ACCESS[A.current.role];
      return acc === '*' || (acc || []).includes(section);
    },

    isAdmin: () => !!A.current && ['owner', 'admin'].includes(A.current.role),
    isOwner: () => !!A.current && A.current.role === 'owner',

    /**
     * Acciones sensibles (anular, cancelar, descuento grande) hechas por
     * alguien que no es encargado: pide usuario y clave de un encargado.
     * Devuelve false si no se autorizó, true si quien opera ya es encargado,
     * o la sesión temporal del encargado que autorizó (para firmar la acción
     * en el servidor). Cerrarla con A.release(auth).
     */
    async release(auth) {
      if (auth && auth !== true && auth.auth) { try { await auth.auth.signOut({ scope: 'local' }); } catch (e) { /* noop */ } }
    },

    requireAdmin(reason = 'Esta acción requiere autorización') {
      if (A.isAdmin()) return Promise.resolve(true);
      return new Promise((resolve) => {
        let done = false;
        const m = PZ.modal({
          title: '🔐 ' + U.esc(reason),
          size: 'sm',
          body: `<p class="muted" style="margin-top:0">Pedile a un encargado o al dueño que ingrese sus datos.</p>
            <label class="field"><span>Usuario o email</span><input class="u" autocapitalize="off" autocomplete="off" autofocus></label>
            <label class="field"><span>Contraseña</span><input class="p" type="password" autocomplete="off"></label>`,
          footer: `<button class="btn ghost" data-a="x">Cancelar</button><button class="btn primary" data-a="ok">Autorizar</button>`,
          onClose: () => { if (!done) resolve(false); },
        });
        const ok = m.el.querySelector('[data-a=ok]');
        m.el.querySelector('[data-a=x]').onclick = () => m.close();
        m.el.querySelector('.p').addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
        ok.onclick = async () => {
          if (!navigator.onLine) return PZ.toast('Para autorizar hace falta conexión', 'warn');
          ok.disabled = true;
          const res = await PZ.cloud.verifyOther(m.el.querySelector('.u').value, m.el.querySelector('.p').value);
          ok.disabled = false;
          const { orgId, branchId } = PZ.store.ctx;
          const valid = res && res.members.some((x) => x.org_id === orgId && x.active && (x.role === 'owner' || (x.role === 'admin' && (!x.branch_ids.length || x.branch_ids.includes(branchId)))));
          if (!valid) {
            if (res) A.release(res.client);
            return PZ.toast('Datos incorrectos o sin permiso de encargado', 'err');
          }
          done = true;
          m.close();
          PZ.store.log('autorización', `${reason} (autorizado por un encargado)`);
          resolve(res.client);
        };
      });
    },
  });
})(window.PZ);
