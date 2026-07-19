// ---------------------------------------------------------------------
// Client-side PDF invoice / receipt generation (spec section 6).
//
// Once a Food Delivery order is delivered or a Pick & Drop trip is
// completed, the customer can download a branded PDF receipt. Everything
// is generated in the browser from the order/booking the customer already
// owns — no card data is ever involved, only the safe transaction summary.
//
// The invoice is rendered as an HTML template, rasterized with html2canvas,
// and placed into a jsPDF page. We do it this way (instead of jsPDF's
// vector doc.text) because jsPDF's built-in fonts can't render Arabic; the
// browser shapes Arabic + applies RTL/bidi natively, so mixed Arabic/Latin
// addresses (common in KSA) render correctly. jsPDF + html2canvas are
// dynamically imported so they only load when a PDF is actually generated.
// ---------------------------------------------------------------------
import { COMPANY } from '../../config/company';

const ORANGE = '#FF7E21';
const DARK = '#1F2937';
const GREY = '#6B7280';
const GREEN = '#16A34A';
const RED = '#DC2626';
const LINE = '#E5E7EB';

// A font stack that includes Arabic-capable families so Arabic addresses
// render (the browser falls back to a system Arabic font otherwise).
const FONT_STACK =
  "'Segoe UI', 'Helvetica Neue', Arial, 'Noto Sans Arabic', 'Segoe UI Arabic', Tahoma, sans-serif";

const money = (n, currency = 'SAR') => `${currency} ${Number(n ?? 0).toFixed(2)}`;

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Build the invoice as an HTML string (self-contained inline styles). Address
// and name fields get dir="auto" so the browser orders Arabic runs RTL.
function invoiceHtml({
  docTitle,
  code,
  dateISO,
  serviceLabel,
  customerName,
  provider,
  summaryTitle,
  lineItems,
  totals,
  grandTotal,
  currency = 'SAR',
  paymentStatus,
  paymentMethod,
  reference,
  meta,
}) {
  const metaRows = [
    { label: 'Reference', value: code },
    { label: 'Service', value: serviceLabel },
    { label: 'Date', value: fmtDate(dateISO) },
    ...(meta || []),
  ];
  const status = String(paymentStatus).toLowerCase();
  const paid = status === 'paid' || status === 'verified';
  const statusColor = paid ? GREEN : status.includes('refund') ? GREY : RED;

  const metaHtml = metaRows.map((r) => `
    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;">
      <span style="font-size:11px;color:${GREY};">${esc(r.label)}</span>
      <span dir="auto" style="font-size:12px;font-weight:700;color:${DARK};text-align:right;">${esc(r.value ?? '—')}</span>
    </div>`).join('');

  const itemsHtml = (lineItems || []).map((item) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:10px 12px;border-bottom:1px solid ${LINE};font-size:13px;color:${DARK};">
      <span dir="auto" style="flex:1;">${esc(item.label)}</span>
      <span style="white-space:nowrap;">${item.amount != null ? esc(money(item.amount, currency)) : ''}</span>
    </div>`).join('');

  const totalsHtml = (totals || []).map((row) => `
    <div style="display:flex;justify-content:space-between;gap:40px;width:55%;font-size:13px;color:${row.bold ? DARK : GREY};font-weight:${row.bold ? 700 : 400};margin-bottom:6px;">
      <span>${esc(row.label)}</span><span>${esc(money(row.amount, currency))}</span>
    </div>`).join('');

  const providerHtml = provider?.name ? `
    <div style="font-size:11px;font-weight:700;color:${GREY};margin-top:10px;letter-spacing:0.04em;">SERVICE PROVIDER</div>
    <div dir="auto" style="font-size:13px;font-weight:700;color:${DARK};margin-top:2px;">${esc(provider.name)}</div>` : '';

  return `
    <div style="width:794px;box-sizing:border-box;padding:44px 48px;background:#fff;color:${DARK};font-family:${FONT_STACK};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="font-size:30px;font-weight:800;color:${DARK};">Smart <span style="color:${ORANGE};">Mappia</span></div>
        <div style="font-size:26px;font-weight:800;color:${DARK};">${esc(docTitle)}</div>
      </div>
      <div style="font-size:12px;color:${GREY};margin-top:8px;line-height:1.5;">
        ${esc(COMPANY.websiteDisplay)}<br>${esc(COMPANY.email)}<br>${esc(COMPANY.address.full)}
      </div>

      <div style="border-top:1px solid ${LINE};margin:18px 0 22px;"></div>

      <div style="display:flex;justify-content:space-between;gap:24px;">
        <div style="flex:1;">
          <div style="font-size:11px;font-weight:700;color:${GREY};letter-spacing:0.04em;">BILLED TO</div>
          <div dir="auto" style="font-size:15px;font-weight:700;color:${DARK};margin-top:4px;">${esc(customerName || 'Smart Mappia customer')}</div>
          ${providerHtml}
        </div>
        <div style="flex:1;max-width:300px;">${metaHtml}</div>
      </div>

      <div style="font-size:14px;font-weight:700;color:${DARK};margin-top:26px;">${esc(summaryTitle)}</div>
      <div style="margin-top:10px;border:1px solid ${LINE};border-radius:6px;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;background:#F9FAFB;padding:9px 12px;font-size:11px;font-weight:700;color:${GREY};letter-spacing:0.04em;">
          <span>DESCRIPTION</span><span>AMOUNT</span>
        </div>
        ${itemsHtml}
      </div>

      <div style="margin-top:20px;display:flex;flex-direction:column;align-items:flex-end;">
        ${totalsHtml}
        <div style="display:flex;justify-content:space-between;gap:40px;width:55%;background:${ORANGE};color:#fff;font-weight:800;font-size:15px;padding:11px 14px;border-radius:6px;margin-top:4px;box-sizing:border-box;">
          <span>TOTAL</span><span>${esc(money(grandTotal, currency))}</span>
        </div>
      </div>

      <div style="margin-top:26px;border:1px solid ${LINE};border-radius:8px;display:flex;">
        <div style="flex:1;padding:14px;">
          <div style="font-size:11px;font-weight:700;color:${GREY};letter-spacing:0.04em;">PAYMENT STATUS</div>
          <div style="font-size:14px;font-weight:800;color:${statusColor};margin-top:6px;">${esc(paid ? 'PAID' : String(paymentStatus || '—').toUpperCase())}</div>
        </div>
        <div style="flex:1;padding:14px;border-left:1px solid ${LINE};">
          <div style="font-size:11px;font-weight:700;color:${GREY};letter-spacing:0.04em;">METHOD</div>
          <div style="font-size:13px;font-weight:700;color:${DARK};margin-top:6px;">${esc(paymentMethod || '—')}</div>
        </div>
        <div style="flex:1;padding:14px;border-left:1px solid ${LINE};">
          <div style="font-size:11px;font-weight:700;color:${GREY};letter-spacing:0.04em;">TRANSACTION REF</div>
          <div dir="auto" style="font-size:12px;color:${DARK};margin-top:6px;word-break:break-all;">${esc(reference || code || '—')}</div>
        </div>
      </div>

      <div style="border-top:1px solid ${LINE};margin-top:40px;padding-top:14px;">
        <div style="font-size:13px;font-weight:700;color:${ORANGE};">Thank you for choosing Smart Mappia!</div>
        <div style="font-size:10px;color:${GREY};margin-top:6px;line-height:1.5;">
          This is a system-generated receipt. All payments are monitored 24/7 and processed through secure, PCI-compliant channels. No card details are stored.
        </div>
      </div>
    </div>`;
}

// Render the HTML off-screen, rasterize it, and save it as a one-page A4 PDF.
async function buildInvoice(model) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;z-index:-1;';
  host.innerHTML = invoiceHtml(model);
  document.body.appendChild(host);
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    // Make sure any web fonts are ready so Arabic shapes before we rasterize.
    if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }

    const canvas = await html2canvas(host.firstElementChild, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    });

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height / canvas.width) * imgW;
    const img = canvas.toDataURL('image/png');

    if (imgH <= pageH) {
      doc.addImage(img, 'PNG', 0, 0, imgW, imgH);
    } else {
      // Taller than one page — tile the single image across pages.
      let position = 0;
      let remaining = imgH;
      while (remaining > 0) {
        doc.addImage(img, 'PNG', 0, position, imgW, imgH);
        remaining -= pageH;
        if (remaining > 0) {
          doc.addPage();
          position -= pageH;
        }
      }
    }
    doc.save(model.fileName);
  } catch (err) {
    console.error('invoice generation failed:', err);
    if (typeof window !== 'undefined') window.alert('Could not generate the PDF. Please try again.');
  } finally {
    document.body.removeChild(host);
  }
}

// --- Public helpers ----------------------------------------------------

const FOOD_METHOD_LABELS = { stcpay: 'STC Pay', tap: 'Card (Tap)', cash: 'Cash on delivery' };

export function downloadFoodInvoice({ order, items, merchant, customerName }) {
  return buildInvoice({
    docTitle: 'RECEIPT',
    fileName: `SmartMappia-Receipt-${order.order_code}.pdf`,
    code: order.order_code,
    dateISO: order.delivered_at || order.created_at,
    serviceLabel: 'Food Delivery',
    customerName,
    provider: merchant ? { name: merchant.name, address: merchant.address } : null,
    summaryTitle: 'Order summary',
    lineItems: (items || []).map((line) => ({
      label: `${line.quantity} × ${line.name_snapshot}`,
      amount: line.line_total,
    })),
    totals: [
      { label: 'Subtotal', amount: order.subtotal },
      { label: 'Delivery fee', amount: order.delivery_fee },
    ],
    grandTotal: order.total,
    paymentStatus: order.payment_status,
    paymentMethod: FOOD_METHOD_LABELS[order.payment_method] || order.payment_method,
    reference: order.order_code,
    meta: [{ label: 'Delivered to', value: order.delivery_address || '—' }],
  });
}

export function downloadRideInvoice({ booking, customerName }) {
  const currency = booking.currency || 'SAR';
  return buildInvoice({
    docTitle: 'INVOICE',
    fileName: `SmartMappia-Invoice-${booking.booking_code}.pdf`,
    code: booking.booking_code,
    dateISO: booking.pickup_datetime || booking.created_at,
    serviceLabel: 'Airport Pick & Drop',
    customerName,
    provider: { name: 'Smart Mappia Transport', address: COMPANY.address.full },
    summaryTitle: 'Trip summary',
    lineItems: [
      { label: `Pickup: ${booking.pickup_address || '—'}`, amount: null },
      { label: `Drop-off: ${booking.dropoff_address || '—'}`, amount: null },
      { label: 'Airport transfer fare', amount: booking.fare_amount },
    ],
    totals: [{ label: 'Fare', amount: booking.fare_amount }],
    grandTotal: booking.fare_amount,
    currency,
    paymentStatus: booking.payment_status,
    paymentMethod: booking.payment_method || 'STC Pay',
    reference: booking.booking_code,
  });
}
