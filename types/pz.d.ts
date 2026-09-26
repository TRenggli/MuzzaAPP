/* Tipos del negocio. Se usan desde JavaScript con comentarios JSDoc
   (por ejemplo: @param {PZ.Product} p) en los archivos con // @ts-check. */

declare namespace PZ {
  /* ---------------- Menú ---------------- */
  interface Variant {
    id: string;
    name: string;
    price: number;
    /** proporción de la receta (grande = 1, chica ≈ 0.6) */
    factor?: number;
  }
  interface Category {
    id: string;
    name: string;
    icon: string;
    /** permite mitad y mitad y agregados (pizzas) */
    allowHalf: boolean;
  }
  interface Product {
    id: string;
    categoryId: string;
    name: string;
    desc?: string;
    active: boolean;
    /** se muestra en la carta online (por defecto sí) */
    online?: boolean;
    color?: string;
    /** foto pública (carta online) */
    photo?: string;
    variants: Variant[];
    recipe?: { ingredientId: string; qty: number }[];
  }
  interface Extra {
    id: string;
    name: string;
    price: number;
  }

  /* ---------------- Pedidos ---------------- */
  type OrderType = 'mostrador' | 'delivery' | 'retiro' | 'mesa';
  type PayMethod = 'efectivo' | 'transferencia' | 'qr' | 'tarjeta';
  type OrderStatus = 'pendiente' | 'horno' | 'preparando' | 'listo' | 'en_camino' | 'entregado' | 'cancelado';

  interface OrderItem {
    id: string;
    productId: string;
    variantId: string;
    variantName: string;
    half: { productId: string; name: string } | null;
    name: string;
    extras: { id: string; name: string; price: number }[];
    qty: number;
    unitPrice: number;
    total: number;
    /** costo teórico de mercadería de una unidad */
    cost?: number;
    notes: string;
  }
  interface Payment {
    method: PayMethod;
    amount: number;
    tendered?: number;
    change?: number;
    ref?: string;
    cardType?: 'débito' | 'crédito';
    /** cobro con QR de Mercado Pago acreditado automáticamente */
    mp?: { order: string; payment?: string };
  }
  interface Order {
    id: string;
    number: number;
    ticketNumber: number | null;
    createdAt: number;
    paidAt: number | null;
    type: OrderType;
    table: string;
    customerName: string;
    phone: string;
    address: string;
    zoneId: string | null;
    items: OrderItem[];
    subtotal?: number;
    discount: { type: '%' | '$'; value: number } | null;
    discountAmount?: number;
    cashDiscount: number;
    surcharge: number;
    deliveryFee: number;
    total?: number;
    payments: Payment[];
    paid: boolean;
    status: OrderStatus;
    notes: string;
    voided: boolean;
    /** pedido que llegó por la carta online */
    web?: { id: string; number: number };
  }

  /* ---------------- Carta online ---------------- */
  type WebOrderType = 'retiro' | 'delivery' | 'mesa';
  type WebPayMethod = 'efectivo' | 'transferencia' | 'tarjeta';

  interface CartaHours {
    mode: 'always' | 'schedule';
    /** 0 = domingo … 6 = sábado */
    days: number[];
    from: string;
    to: string;
  }
  interface CartaTheme {
    preset: string;
    primary: string;
    accent: string;
    bg: string;
    font: 'redonda' | 'clasica' | 'moderna';
    layout: 'grilla' | 'lista';
    dark: boolean;
  }
  interface CartaSettings {
    enabled: boolean;
    whatsapp: string;
    paused: boolean;
    hours: CartaHours;
    types: Record<WebOrderType, boolean>;
    payments: Record<WebPayMethod, boolean>;
    minOrder: number;
    welcome: string;
    cover: string;
    logo: string;
    showPhotos: boolean;
    theme: CartaTheme;
  }
  interface Zone {
    id: string;
    name: string;
    fee: number;
  }

  /** Lo que devuelve la base para la carta pública (sin costos ni recetas) */
  interface CartaMenu {
    branch: { id: string; name: string; slug: string | null; org: string };
    settings: {
      business: { name?: string; slogan?: string; address?: string; city?: string; phone?: string; instagram?: string };
      online: CartaSettings;
      halfPricing: 'max' | 'avg';
      zones: Zone[];
      transfer: { alias?: string; cbu?: string; holder?: string; bank?: string } | null;
      logo: string | null;
    };
    open: boolean;
    categories: Category[];
    products: Product[];
    extras: Extra[];
  }

  /** Línea del carrito de la carta (lo que elige el cliente) */
  interface CartLine {
    key: string;
    productId: string;
    variantId: string;
    halfId: string;
    extras: string[];
    qty: number;
    notes: string;
  }

  /** Pedido web guardado por el servidor (precios calculados en la base) */
  interface WebOrder {
    id: string;
    number: number;
    createdAt: string;
    type: WebOrderType;
    name: string;
    phone: string;
    address: string;
    zoneId: string | null;
    zoneName: string | null;
    table: string;
    payment: WebPayMethod;
    cashWith: number | null;
    notes: string;
    items: OrderItem[];
    subtotal: number;
    deliveryFee: number;
    total: number;
  }
}

interface Window {
  PZ: any;
  PZ_CONFIG: { supabaseUrl: string; supabaseKey: string; staffDomain: string; version: string };
  supabase: any;
  qrcode: any;
  webkitAudioContext?: typeof AudioContext;
}

declare var qrcode: any;
