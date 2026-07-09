// ---------------------------------------------------------------------
// Client-side PDF invoice / receipt generation (spec section 6).
//
// Once a Food Delivery order is delivered or a Pick & Drop trip is
// completed, the customer can download a branded PDF receipt. Everything
// is generated in the browser from the order/booking the customer already
// owns — no card data is ever involved, only the safe transaction summary.
// ---------------------------------------------------------------------
import { jsPDF } from 'jspdf';
import { COMPANY } from '../../config/company';

const ORANGE = [255, 126, 33];
const DARK = [31, 41, 55];
const GREY = [107, 114, 128];
const GREEN = [22, 163, 74];
const RED = [220, 38, 38];
const LINE = [229, 231, 235];

const money = (n, currency = 'SAR') => `${currency} ${Number(n ?? 0).toFixed(2)}`;

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

// Draws a full invoice from a normalized model and triggers the download.
function buildInvoice({
  docTitle,
  fileName,
  code,
  dateISO,
  serviceLabel,
  customerName,
  provider, // { name, address }
  summaryTitle,
  lineItems, // [{ label, amount }]
  totals, // [{ label, amount, bold }]
  grandTotal,
  currency = 'SAR',
  paymentStatus,
  paymentMethod,
  reference,
  meta, // extra [{ label, value }] rows in the details column
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 48; // page margin
  let y = 54;

  // --- Brand header ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...DARK);
  doc.text('Smart', M, y);
  const smartW = doc.getTextWidth('Smart ');
  doc.setTextColor(...ORANGE);
  doc.text('Mappia', M + smartW, y);

  // Document type (right aligned)
  doc.setTextColor(...DARK);
  doc.setFontSize(20);
  doc.text(docTitle, pageW - M, y, { align: 'right' });

  // Company contact
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  y += 18;
  doc.text(COMPANY.websiteDisplay, M, y);
  y += 12;
  doc.text(COMPANY.email, M, y);
  y += 12;
  doc.text(COMPANY.address.full, M, y, { maxWidth: pageW - M * 2 });

  // Divider
  y += 18;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(1);
  doc.line(M, y, pageW - M, y);
  y += 26;

  // --- Billed to + invoice meta (two columns) ---
  const colR = pageW / 2 + 20;
  const topY = y;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text('BILLED TO', M, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  y += 16;
  doc.text(customerName || 'Smart Mappia customer', M, y);
  if (provider?.name) {
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text('SERVICE PROVIDER', M, y);
    y += 13;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    doc.text(provider.name, M, y, { maxWidth: colR - M - 12 });
  }

  // Right column: meta rows
  let ry = topY;
  const metaRows = [
    { label: 'Reference', value: code },
    { label: 'Service', value: serviceLabel },
    { label: 'Date', value: fmtDate(dateISO) },
    ...(meta || []),
  ];
  metaRows.forEach((row) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text(String(row.label), colR, ry);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    doc.text(String(row.value ?? '—'), pageW - M, ry, { align: 'right' });
    ry += 16;
  });

  y = Math.max(y, ry) + 28;

  // --- Line items ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(summaryTitle, M, y);
  y += 14;

  // Table header
  doc.setFillColor(249, 250, 251);
  doc.rect(M, y, pageW - M * 2, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text('DESCRIPTION', M + 10, y + 15);
  doc.text('AMOUNT', pageW - M - 10, y + 15, { align: 'right' });
  y += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  (lineItems || []).forEach((item) => {
    y += 20;
    doc.setTextColor(...DARK);
    doc.text(String(item.label), M + 10, y, { maxWidth: pageW - M * 2 - 120 });
    if (item.amount != null) {
      doc.text(money(item.amount, currency), pageW - M - 10, y, { align: 'right' });
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(M, y + 8, pageW - M, y + 8);
  });

  // --- Totals ---
  y += 26;
  const totalsX = pageW / 2;
  (totals || []).forEach((row) => {
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...(row.bold ? DARK : GREY));
    doc.text(String(row.label), totalsX, y);
    doc.text(money(row.amount, currency), pageW - M, y, { align: 'right' });
    y += 18;
  });

  // Grand total band
  y += 4;
  doc.setFillColor(...ORANGE);
  doc.roundedRect(totalsX - 4, y - 2, pageW - M - (totalsX - 4), 30, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL', totalsX + 8, y + 18);
  doc.text(money(grandTotal, currency), pageW - M - 8, y + 18, { align: 'right' });
  y += 48;

  // --- Payment status box ---
  const paid = String(paymentStatus).toLowerCase() === 'paid' || String(paymentStatus).toLowerCase() === 'verified';
  const statusColor = paid ? GREEN : String(paymentStatus).toLowerCase().includes('refund') ? GREY : RED;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(1);
  doc.roundedRect(M, y, pageW - M * 2, 58, 6, 6, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text('PAYMENT STATUS', M + 14, y + 20);
  doc.text('METHOD', M + (pageW - M * 2) / 3 + 14, y + 20);
  doc.text('TRANSACTION REF', M + ((pageW - M * 2) / 3) * 2 + 14, y + 20);
  doc.setFontSize(11);
  doc.setTextColor(...statusColor);
  doc.text(paid ? 'PAID' : String(paymentStatus || '—').toUpperCase(), M + 14, y + 40);
  doc.setTextColor(...DARK);
  doc.text(String(paymentMethod || '—'), M + (pageW - M * 2) / 3 + 14, y + 40);
  doc.setFontSize(9);
  doc.text(String(reference || code || '—'), M + ((pageW - M * 2) / 3) * 2 + 14, y + 40, { maxWidth: (pageW - M * 2) / 3 - 20 });
  y += 82;

  // --- Security note + thank you (footer) ---
  const footerY = doc.internal.pageSize.getHeight() - 70;
  y = Math.max(y, footerY);
  doc.setDrawColor(...LINE);
  doc.line(M, y, pageW - M, y);
  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...ORANGE);
  doc.text('Thank you for choosing Smart Mappia!', M, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(
    'This is a system-generated receipt. All payments are monitored 24/7 and processed through secure, PCI-compliant channels. No card details are stored.',
    M,
    y,
    { maxWidth: pageW - M * 2 }
  );

  doc.save(fileName);
}

// --- Public helpers ----------------------------------------------------

const FOOD_METHOD_LABELS = { stcpay: 'STC Pay', tap: 'Card (Tap)', cash: 'Cash on delivery' };

export function downloadFoodInvoice({ order, items, merchant, customerName }) {
  buildInvoice({
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
    meta: [{ label: 'Delivered to', value: (order.delivery_address || '').slice(0, 40) }],
  });
}

export function downloadRideInvoice({ booking, customerName }) {
  const currency = booking.currency || 'SAR';
  buildInvoice({
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
