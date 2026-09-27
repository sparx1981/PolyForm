import type { FloorPlan, PlanOpening } from './floorPlans';
import type { BomLine } from './bom';

/**
 * Printable A3 drawing set for the client page: one sheet per floor plan (vector, so it prints
 * sharp at any size), then the door and window schedule and the quantities. Built in the
 * browser; the PDF libraries load only when someone asks for the file.
 */
export async function drawingSetPdf(input: {
  title: string;
  subtitle: string;
  plans: FloorPlan[];
  openings: PlanOpening[];
  bom: BomLine[];
}): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const titleBlock = (sheet: string, n: number, of: number) => {
    pdf.setDrawColor(40);
    pdf.setLineWidth(0.4);
    pdf.rect(margin, margin, W - margin * 2, H - margin * 2);
    const y = H - margin - 16;
    pdf.line(margin, y, W - margin, y);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(input.title, margin + 5, y + 7);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(input.subtitle, margin + 5, y + 12.5);
    pdf.text(sheet, W / 2, y + 7, { align: 'center' });
    pdf.text(`${date}  ·  Sheet ${n} of ${of}  ·  Not to scale unless stated  ·  PolyForm`, W - margin - 5, y + 12.5, { align: 'right' });
  };

  const sheets = input.plans.length + 1;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < input.plans.length; i++) {
      if (i > 0) pdf.addPage();
      const plan = input.plans[i];
      host.innerHTML = plan.svg;
      const svg = host.querySelector('svg')!;
      const vw = Number(svg.getAttribute('width')), vh = Number(svg.getAttribute('height'));
      const boxW = W - margin * 2 - 10, boxH = H - margin * 2 - 26;
      const k = Math.min(boxW / vw, boxH / vh);
      await pdf.svg(svg, { x: margin + 5 + (boxW - vw * k) / 2, y: margin + 5 + (boxH - vh * k) / 2, width: vw * k, height: vh * k });
      titleBlock(`Floor plan · Level ${plan.level}`, i + 1, sheets);
    }
  } finally {
    host.remove();
  }

  // Schedules sheet.
  if (input.plans.length) pdf.addPage();
  let y = margin + 12;
  const x0 = margin + 6;
  const table = (heading: string, cols: { label: string; w: number; align?: 'left' | 'right' }[], rows: string[][]) => {
    if (!rows.length) return;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(heading, x0, y);
    y += 6;
    pdf.setFontSize(9);
    let x = x0;
    cols.forEach(c => { pdf.text(c.label, c.align === 'right' ? x + c.w - 2 : x, y, { align: c.align ?? 'left' }); x += c.w; });
    y += 2;
    pdf.setLineWidth(0.2);
    pdf.line(x0, y, x0 + cols.reduce((a, c) => a + c.w, 0), y);
    y += 5;
    pdf.setFont('helvetica', 'normal');
    for (const r of rows) {
      if (y > H - margin - 24) {
        titleBlock('Schedules', sheets, sheets);
        pdf.addPage();
        y = margin + 12;
      }
      x = x0;
      r.forEach((cell, i) => { const c = cols[i]; pdf.text(cell, c.align === 'right' ? x + c.w - 2 : x, y, { align: c.align ?? 'left' }); x += c.w; });
      y += 5.2;
    }
    y += 8;
  };
  table('Door & window schedule', [
    { label: 'Mark', w: 22 }, { label: 'Type', w: 26 }, { label: 'Level', w: 20 }, { label: 'Width (mm)', w: 30, align: 'right' },
    { label: 'Height (mm)', w: 30, align: 'right' }, { label: 'Sill (mm)', w: 28, align: 'right' }, { label: 'Style', w: 60 },
  ], input.openings.map(o => [o.mark, o.kind === 'door' ? 'Door' : 'Window', String(o.level), mm(o.width), mm(o.height), o.kind === 'door' ? '–' : mm(o.sill), o.style ?? '']));
  table('Quantities', [
    { label: 'Group', w: 50 }, { label: 'Item', w: 60 }, { label: 'Detail', w: 110 }, { label: 'Quantity', w: 30, align: 'right' }, { label: 'Unit', w: 20 },
  ], input.bom.map(l => [l.group, l.item, l.detail ?? '', String(l.qty), l.unit]));
  titleBlock('Schedules', sheets, sheets);
  return pdf.output('blob');
}

const mm = (m: number) => String(Math.round(m * 1000));
