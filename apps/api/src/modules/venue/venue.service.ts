import type { z } from 'zod';
import type { DeliveryApp, DiningTable, Printer } from '@prisma/client';
import { prisma } from '../../core/db';
import { conflict, notFound } from '../../core/errors';
import { writeAudit } from '../../core/audit';
import { sendToPrinter, testPage } from '../../core/printing';
import type {
  areaInput,
  deliveryAppInput,
  DeliveryAppDto,
  printerInput,
  PrinterDto,
  tableInput,
  TableDto,
} from '../../contracts/venue.contract';

const toTable = (t: DiningTable): TableDto => ({
  id: t.id,
  areaId: t.areaId,
  name: t.name,
  seats: t.seats,
  sort: t.sort,
  active: t.active,
});
const toApp = (a: DeliveryApp): DeliveryAppDto => ({
  id: a.id,
  name: a.name,
  commissionPct: a.commissionPct.toString(),
  active: a.active,
});
const toPrinter = (p: Printer): PrinterDto => ({
  id: p.id,
  name: p.name,
  ip: p.ip,
  port: p.port,
  paperWidth: p.paperWidth === 58 ? 58 : 80,
  role: p.role,
  active: p.active,
});

// ---- areas & tables
export async function listAreas() {
  const areas = await prisma.area.findMany({
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: { tables: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] } },
  });
  return areas.map((a) => ({ id: a.id, name: a.name, sort: a.sort, tables: a.tables.map(toTable) }));
}

export async function createArea(userId: number, input: z.infer<typeof areaInput>) {
  const a = await prisma.area.create({ data: input });
  await writeAudit(prisma, { entity: 'area', entityId: a.id, action: 'CREATE', after: input, userId });
  return { ...a, tables: [] };
}

export async function updateArea(userId: number, id: number, input: z.infer<typeof areaInput>) {
  if (!(await prisma.area.findUnique({ where: { id } }))) throw notFound('Khu vực');
  await prisma.area.update({ where: { id }, data: input });
  await writeAudit(prisma, { entity: 'area', entityId: id, action: 'UPDATE', after: input, userId });
  return (await listAreas()).find((a) => a.id === id)!;
}

export async function createTable(userId: number, input: z.infer<typeof tableInput>) {
  if (!(await prisma.area.findUnique({ where: { id: input.areaId } }))) throw notFound('Khu vực');
  const t = await prisma.diningTable.create({ data: input });
  await writeAudit(prisma, { entity: 'table', entityId: t.id, action: 'CREATE', after: input, userId });
  return toTable(t);
}

export async function updateTable(userId: number, id: number, input: z.infer<typeof tableInput>) {
  const before = await prisma.diningTable.findUnique({ where: { id } });
  if (!before) throw notFound('Bàn');
  // A hidden table drops off the floor plan: never while guests still have an unpaid order on it.
  if (before.active && !input.active) {
    const open = await prisma.order.count({ where: { tableId: id, status: 'OPEN' } });
    if (open)
      throw conflict(
        'TABLE_IN_USE',
        `${before.name} đang có đơn chưa thanh toán — thanh toán, huỷ hoặc chuyển bàn trước khi ẩn`,
      );
  }
  const t = await prisma.diningTable.update({ where: { id }, data: input });
  await writeAudit(prisma, {
    entity: 'table',
    entityId: id,
    action: 'UPDATE',
    before: toTable(before),
    after: input,
    userId,
  });
  return toTable(t);
}

// ---- delivery apps
export const listApps = async () =>
  (await prisma.deliveryApp.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] })).map(toApp);

export async function createApp(userId: number, input: z.infer<typeof deliveryAppInput>) {
  const a = await prisma.deliveryApp.create({ data: input });
  await writeAudit(prisma, {
    entity: 'delivery_app',
    entityId: a.id,
    action: 'CREATE',
    after: input,
    userId,
  });
  return toApp(a);
}

export async function updateApp(userId: number, id: number, input: z.infer<typeof deliveryAppInput>) {
  const before = await prisma.deliveryApp.findUnique({ where: { id } });
  if (!before) throw notFound('App giao hàng');
  const a = await prisma.deliveryApp.update({ where: { id }, data: input });
  await writeAudit(prisma, {
    entity: 'delivery_app',
    entityId: id,
    action: 'UPDATE',
    before: toApp(before),
    after: input,
    userId,
  });
  return toApp(a);
}

// ---- printers
export const listPrinters = async () =>
  (await prisma.printer.findMany({ orderBy: [{ role: 'asc' }, { name: 'asc' }] })).map(toPrinter);

export async function createPrinter(userId: number, input: z.infer<typeof printerInput>) {
  const p = await prisma.printer.create({ data: input });
  await writeAudit(prisma, { entity: 'printer', entityId: p.id, action: 'CREATE', after: input, userId });
  return toPrinter(p);
}

export async function updatePrinter(userId: number, id: number, input: z.infer<typeof printerInput>) {
  const before = await prisma.printer.findUnique({ where: { id } });
  if (!before) throw notFound('Máy in');
  const p = await prisma.printer.update({ where: { id }, data: input });
  await writeAudit(prisma, {
    entity: 'printer',
    entityId: id,
    action: 'UPDATE',
    before: toPrinter(before),
    after: input,
    userId,
  });
  return toPrinter(p);
}

export async function testPrinter(id: number) {
  const p = await prisma.printer.findUnique({ where: { id } });
  if (!p) throw notFound('Máy in');
  await sendToPrinter(p.ip, p.port, testPage(p.name, p.paperWidth));
  return { ok: true as const };
}
