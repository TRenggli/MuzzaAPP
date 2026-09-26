// Cliente de la API de Mercado Pago (Orders API, QR dinámico).
// Sin dependencias: lo usa la función "mp" (Deno) y las pruebas (Node).
//
//   1. Una vez por negocio: se guarda el Access Token (se valida con /users/me).
//   2. Una vez por sucursal: se crea la sucursal (store) y la caja (POS).
//   3. En cada cobro: POST /v1/orders con type "qr" y mode "dynamic" →
//      devuelve qr_data (el texto del QR con el monto) y se consulta el
//      estado hasta que queda "processed" (pagado).

export const API = 'https://api.mercadopago.com';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface MpOrder {
  id: string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string;
  type_response?: { qr_data?: string };
  transactions?: {
    payments?: Array<{
      id: string;
      amount?: string;
      paid_amount?: string;
      status?: string;
      status_detail?: string;
      payment_method?: { id?: string; type?: string; installments?: number };
    }>;
  };
}

export interface MpUser { id: number; nickname: string; site_id: string }

export interface StoreLocation {
  street_name: string;
  street_number: string;
  city_name: string;
  state_name: string;
  latitude: number;
  longitude: number;
  reference?: string;
}

export class MpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(mpErrorMessage(status, body));
    this.status = status;
    this.body = body;
  }
}

/** Mensaje entendible para el local a partir de la respuesta de Mercado Pago */
export function mpErrorMessage(status: number, body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const first = Array.isArray(b.errors) && b.errors[0] ? b.errors[0] : null;
  const detail = String((first && (first.message || first.code)) || b.message || b.error || '').trim();
  if (status === 401 || status === 403) return 'Mercado Pago rechazó las credenciales: revisá que el Access Token sea el de producción y esté vigente.';
  if (status === 404) return 'Mercado Pago no encontró el recurso pedido' + (detail ? ` (${detail})` : '');
  if (status === 429) return 'Mercado Pago está limitando las consultas. Probá de nuevo en unos segundos.';
  if (status >= 500) return 'Mercado Pago no responde en este momento. Probá de nuevo en un rato.';
  return 'Mercado Pago: ' + (detail || `error ${status}`);
}

/** Montos como los pide la API: texto con dos decimales */
export const amount = (n: number): string => (Math.round(Number(n) * 100) / 100).toFixed(2);

/** Referencia externa válida: letras, números, - y _ (máx. 64) */
export const validReference = (s: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(String(s || ''));

/** Identificadores de sucursal y caja en Mercado Pago a partir de la sucursal del sistema */
export function externalIds(branchId: string) {
  const short = String(branchId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toUpperCase();
  return { store: `PZ${short}`, pos: `PZ${short}C1` };
}

/** Estado simple para la caja */
export type PayState = 'pending' | 'paid' | 'expired' | 'canceled' | 'refunded' | 'failed';
export function orderState(o: Pick<MpOrder, 'status' | 'status_detail'>): PayState {
  const s = String(o.status || '').toLowerCase();
  const d = String(o.status_detail || '').toLowerCase();
  if (s === 'processed' || d === 'accredited') return 'paid';
  if (s === 'expired') return 'expired';
  if (s === 'canceled' || s === 'cancelled') return 'canceled';
  if (s === 'refunded') return 'refunded';
  if (s === 'failed' || s === 'rejected') return 'failed';
  return 'pending';
}

/** Cuerpo del pedido de cobro con QR dinámico */
export function qrOrderBody(p: { total: number; reference: string; externalPosId: string; description?: string; minutes?: number }) {
  if (!(p.total > 0)) throw new Error('El monto tiene que ser mayor a cero');
  if (!validReference(p.reference)) throw new Error('Referencia inválida');
  const minutes = Math.min(60, Math.max(1, Math.round(p.minutes || 10)));
  return {
    type: 'qr',
    total_amount: amount(p.total),
    description: String(p.description || 'Pedido').slice(0, 150),
    external_reference: p.reference,
    expiration_time: `PT${minutes}M`,
    config: { qr: { external_pos_id: p.externalPosId, mode: 'dynamic' } },
    transactions: { payments: [{ amount: amount(p.total) }] },
  };
}

export function mpClient(token: string, fetchImpl: Fetch = fetch) {
  async function call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    const res = await fetchImpl(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new MpError(res.status, data);
    return data as T;
  }

  return {
    me: () => call<MpUser>('GET', '/users/me'),

    async findStore(userId: number, externalId: string): Promise<{ id: string } | null> {
      const r = await call<{ results?: Array<{ id: string | number; external_id?: string }> }>(
        'GET', `/users/${userId}/stores/search?external_id=${encodeURIComponent(externalId)}`);
      const s = (r.results || []).find((x) => x.external_id === externalId);
      return s ? { id: String(s.id) } : null;
    },

    createStore: (userId: number, p: { name: string; externalId: string; location: StoreLocation }) =>
      call<{ id: string | number }>('POST', `/users/${userId}/stores`, {
        name: p.name.slice(0, 60),
        external_id: p.externalId,
        location: {
          street_name: p.location.street_name,
          street_number: String(p.location.street_number),
          city_name: p.location.city_name,
          state_name: p.location.state_name,
          latitude: Number(p.location.latitude),
          longitude: Number(p.location.longitude),
          reference: p.location.reference || '',
        },
      }),

    async findPos(externalId: string): Promise<{ id: string } | null> {
      const r = await call<{ results?: Array<{ id: string | number; external_id?: string }> }>(
        'GET', `/pos?external_id=${encodeURIComponent(externalId)}`);
      const s = (r.results || []).find((x) => x.external_id === externalId);
      return s ? { id: String(s.id) } : null;
    },

    createPos: (p: { name: string; storeId: string; externalId: string }, idempotencyKey: string) =>
      call<{ id: string | number }>('POST', '/v2/pos', {
        name: p.name.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 45) || p.externalId,
        store_id: String(p.storeId),
        external_id: p.externalId,
        config: { qr: { operating_mode: 'pdv' } },
      }, idempotencyKey),

    createQrOrder: (body: ReturnType<typeof qrOrderBody>, idempotencyKey: string) =>
      call<MpOrder>('POST', '/v1/orders', body, idempotencyKey),

    getOrder: (id: string) => call<MpOrder>('GET', `/v1/orders/${encodeURIComponent(id)}`),

    cancelOrder: (id: string, idempotencyKey: string) =>
      call<MpOrder>('POST', `/v1/orders/${encodeURIComponent(id)}/cancel`, undefined, idempotencyKey),
  };
}

export type MpClient = ReturnType<typeof mpClient>;
