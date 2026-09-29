# 🚀 Guía de Puesta en Producción (Go-to-Live)

Este documento detalla los pasos manuales que dependen del operador/dueño para encender el sistema **Pizzería Diego** en el entorno de producción real.

---

## 📋 Resumen de Tareas Pendientes

| # | Tarea | Dónde se hace | Tiempo estimado |
|---|---|---|---|
| **1** | Desplegar Edge Function `mp-webhook` | Terminal local (PowerShell) | 3 minutos |
| **2** | Configurar Webhook en Mercado Pago | Panel de Desarrolladores MP | 2 minutos |
| **3** | Vincular Access Token y Caja en el local | Sistema (Configuración → Cobros) | 2 minutos |
| **4** | Configurar demoras y WhatsApp de pedidos | Sistema (Configuración → Negocio / Carta) | 2 minutos |
| **5** | Prueba de humo en vivo (End-to-End) | Salón, Mostrador y Celular | 5 minutos |

---

## Paso 1: Desplegar Edge Functions a Supabase

La función autónoma `mp-webhook` permite que cuando un cliente pague un QR dinámico de Mercado Pago, la venta se concilie y se marque como pagada automáticamente, **incluso si el cajero cerró el navegador, apagó la tablet o se cortó la red local**.

### Comandos a ejecutar en la terminal (PowerShell):

```powershell
# 1. Iniciar sesión en Supabase (abrirá el navegador para autorizar con tu cuenta)
npx supabase login

# 2. Vincular el proyecto remoto de Supabase (Ref: yugonymkwdlyfdrrhntf)
npx supabase link --project-ref yugonymkwdlyfdrrhntf

# 3. Desplegar la función del webhook autónomo
npx supabase functions deploy mp-webhook

# (Opcional recomendado) Desplegar todas las funciones para asegurar paridad total:
npx supabase functions deploy
```

> **Nota:** La función `mp-webhook` ya tiene configurado `verify_jwt = false` en `supabase/config.toml`, por lo que Mercado Pago podrá notificarla directamente sin requerir token interno de Supabase.

---

## Paso 2: Registrar la URL del Webhook en Mercado Pago

Para que Mercado Pago envíe los avisos de cobro a tu servidor:

1. Ingresá al **Panel de Desarrolladores de Mercado Pago**:  
   👉 [https://www.mercadopago.com.ar/developers/panel/webhooks](https://www.mercadopago.com.ar/developers/panel/webhooks)
2. Seleccioná tu **Aplicación de Producción**.
3. En el menú lateral, andá a **Webhooks / Notificaciones IPN**.
4. Hacé clic en **Configurar notificaciones** o **Nuevo Webhook**.
5. Ingresá la URL pública de la función:
   ```text
   https://yugonymkwdlyfdrrhntf.supabase.co/functions/v1/mp-webhook
   ```
6. En **Eventos a escuchar**, tildá obligatoriamente:
   - ✅ **Pagos** (`payment`)
   - ✅ **Órdenes de comerciante / Merchant Orders** (`merchant_order`)
7. Hacé clic en **Guardar**.

---

## Paso 3: Conectar la Cuenta y la Caja en el Local

1. En el panel de Mercado Pago Developers, copiá tu **Access Token de Producción** (empieza con `APP_USR-...`).
2. Abrí el sistema de gestión con usuario dueño (ej. `diego`).
3. Andá a **Configuración ⚙️ → Cobros (Mercado Pago)**.
4. Pegá el Access Token y hacé clic en **Conectar cuenta**.
   - *El Access Token queda guardado en el servidor con encriptación RLS y nunca se envía a los navegadores de los empleados.*
5. En la misma pantalla, hacé clic en **Activar esta sucursal**:
   - El sistema crea automáticamente la Sucursal física (*Store*) y la Caja virtual (*POS*) en los servidores de Mercado Pago con el nombre y ubicación del local.

---

## Paso 4: Ajustar Demoras y Datos del Local

Desde **Configuración ⚙️**:

1. **Tiempos de entrega y retiro**:
   - En **Carta online**: definí los minutos estimados para *Retiro en el local* (ej. `15 min`) y *Envío por delivery* (ej. `40 min`).
   - Estos valores se reflejan en tiempo real en la carta visible para los clientes.
2. **WhatsApp de pedidos**:
   - Cargá el número de teléfono con código de área (ej. `54911xxxxxxxx`).
3. **Dirección pública (Slug)**:
   - Asigná la dirección amigable del local (ej. `pizzeria-diego-centro`).
   - Tu carta quedará activa en: `https://trenggli.github.io/pizzeria-diego/carta.html?l=pizzeria-diego-centro`.

---

## Paso 5: Prueba de Humo en Vivo (Checklist de Validación)

Antes de abrir las puertas con público real, ejecutá esta verificación rápida:

- [ ] **Cobro QR Mercado Pago de $10 o $100**:
  - Desde el mostrador, iniciá una venta con método **Mercado Pago QR**.
  - Escaneá el QR con la app de Mercado Pago o banco desde un teléfono.
  - Verificá que en cuanto se procesa el pago, la pantalla del sistema suena y emite el comprobante automáticamente.
  - Verificá que en **Historial de Ventas** figure con método `QR` y referencia `MP <id>`.
- [ ] **Comandero de Salón**:
  - En **Salón y mesas**, abrí una mesa (ej. Mesa 1 con 3 comensales).
  - Agregá una pizza y enviá la primera tanda.
  - Verificá que la mesa pase a estado ocupada (rojo) y que sume el saldo exacto del catálogo.
  - Cobrá la mesa y confirmá que se libere (verde).
- [ ] **Pedido Web de Prueba**:
  - Abrí la carta online desde un celular ajeno.
  - Armá un pedido mitad y mitad con dirección estructurada (calle, piso, entrecalles).
  - Tocá **Pedir por WhatsApp** y confirmá que el pedido aparezca con sonido en la campana de **Pedidos** en el sistema.
- [ ] **Consulta de Gastos Históricos**:
  - En **Gastos y ganancias**, seleccioná un mes anterior en el desplegable de 24 meses.
  - Verificá que aparezca el banner verde con icono de nube `☁️ Período histórico (>45 días)` con los datos consolidados.

---

## 🌐 Enlaces Clave del Proyecto

- **Sistema de Gestión:** [https://trenggli.github.io/pizzeria-diego/](https://trenggli.github.io/pizzeria-diego/)
- **Landing Comercial SaaS:** [https://trenggli.github.io/pizzeria-diego/landing.html](https://trenggli.github.io/pizzeria-diego/landing.html)
- **Carta Online Pública:** `https://trenggli.github.io/pizzeria-diego/carta.html?l=<slug>`
- **Proyecto Supabase:** `https://supabase.com/dashboard/project/yugonymkwdlyfdrrhntf`
