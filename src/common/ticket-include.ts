export const TICKET_INCLUDE = {
  transporter: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNo: true, capacityQty: true } },
  bay: { select: { id: true, name: true } },
  lines: { include: { agent: { select: { id: true, code: true, name: true } } } },
} as const;
