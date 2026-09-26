// @ts-check
/* Conexión a Supabase. La clave "publishable" es pública por diseño:
   la seguridad la dan las políticas RLS de la base de datos. */
window.PZ_CONFIG = {
  supabaseUrl: 'https://yugonymkwdlyfdrrhntf.supabase.co',
  supabaseKey: 'sb_publishable_07jHXZFvDxLMZ3rictBG1w_xtNrNo00',
  // Los empleados ingresan con usuario; internamente es usuario@este-dominio
  staffDomain: 'staff.pizzeria.local',
  // Versión de la app (aparece en el registro de errores)
  version: '4.0.0',
};
