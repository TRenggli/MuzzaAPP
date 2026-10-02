// Gestión de empleados de un negocio (dueño, encargado o plataforma):
//   create   → crea el usuario (ingresa con nombre de usuario) y su membresía
//   password → cambia la contraseña de un empleado
//   delete   → quita al empleado del negocio
// Un encargado solo gestiona empleados (no encargados) de SUS sucursales.
import { adminClient, cors, dupMsg, json, loginEmail, validUsername } from '../_shared/common.ts';

const ROLES = ['admin', 'cajero', 'mozo', 'cocina', 'delivery'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const admin = adminClient();
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(token);
    const caller = auth?.user;
    if (!caller) return json({ error: 'Sesión inválida' }, 401);

    const body = await req.json();
    const { action, org_id } = body;
    if (!org_id) return json({ error: 'Falta el negocio' }, 400);

    const { data: pa } = await admin.from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle();
    const { data: me } = await admin.from('members').select('role, active, branch_ids')
      .eq('org_id', org_id).eq('user_id', caller.id).maybeSingle();
    const isPlatform = !!pa;
    if (!isPlatform && (!me || !me.active || !['owner', 'admin'].includes(me.role))) {
      return json({ error: 'No tenés permiso para gestionar usuarios' }, 403);
    }
    const isOwner = isPlatform || me?.role === 'owner';
    const myBranches: string[] = isOwner ? [] : (me?.branch_ids || []);
    const inMyBranches = (ids: string[]) => isOwner || !myBranches.length || (ids.length > 0 && ids.every((b) => myBranches.includes(b)));

    const target = async (userId: string) => {
      const { data } = await admin.from('members').select('role, branch_ids').eq('org_id', org_id).eq('user_id', userId).maybeSingle();
      return data;
    };

    if (action === 'create') {
      const username = String(body.username || '').trim().toLowerCase();
      const { name, password, role } = body;
      const branchIds: string[] = Array.isArray(body.branch_ids) ? body.branch_ids : [];
      if (!validUsername(username)) return json({ error: 'El usuario debe tener 3 a 30 letras, números, punto o guion, sin espacios' }, 400);
      if (!name || !String(name).trim()) return json({ error: 'Falta el nombre' }, 400);
      if (!password || String(password).length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
      if (!ROLES.includes(role)) return json({ error: 'Rol inválido' }, 400);
      if (role === 'admin' && !isOwner) return json({ error: 'Solo el dueño puede crear encargados' }, 403);
      if (!inMyBranches(branchIds)) return json({ error: 'Solo podés asignar tus sucursales' }, 403);
      if (branchIds.length) {
        const { data: brs } = await admin.from('branches').select('id').eq('org_id', org_id).in('id', branchIds);
        if ((brs || []).length !== branchIds.length) return json({ error: 'Sucursal inválida' }, 400);
      }

      const { data: created, error } = await admin.auth.admin.createUser({
        email: loginEmail(username), password, email_confirm: true, user_metadata: { name: String(name).trim() },
      });
      if (error || !created.user) return json({ error: dupMsg(error?.message || '', 'Ese nombre de usuario ya existe, probá con otro') }, 400);
      const { error: memErr } = await admin.from('members').insert({
        org_id, user_id: created.user.id, name: String(name).trim(), username, role, branch_ids: branchIds,
      });
      if (memErr) { await admin.auth.admin.deleteUser(created.user.id); throw memErr; }
      return json({ ok: true, user_id: created.user.id });
    }

    if (action === 'password' || action === 'delete') {
      const { user_id } = body;
      const t = await target(user_id);
      if (!t) return json({ error: 'Usuario no encontrado' }, 404);
      const self = user_id === caller.id;
      if (t.role === 'owner' && !self && !isPlatform) return json({ error: 'No se puede modificar al dueño' }, 403);
      if (t.role === 'admin' && !isOwner && !self) return json({ error: 'Solo el dueño puede modificar encargados' }, 403);
      if (!self && !inMyBranches(t.branch_ids || [])) return json({ error: 'Ese empleado no es de tus sucursales' }, 403);

      if (action === 'password') {
        if (!body.password || String(body.password).length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
        const { error } = await admin.auth.admin.updateUserById(user_id, { password: body.password });
        if (error) throw error;
        return json({ ok: true });
      }

      if (t.role === 'owner') return json({ error: 'No se puede quitar al dueño' }, 403);
      await admin.from('members').delete().eq('org_id', org_id).eq('user_id', user_id);
      const { count } = await admin.from('members').select('*', { count: 'exact', head: true }).eq('user_id', user_id);
      if (!count) await admin.auth.admin.deleteUser(user_id);
      return json({ ok: true });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || 'Error inesperado' }, 500);
  }
});
