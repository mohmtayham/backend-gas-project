-- Optional hardening. Run once AFTER `npx prisma migrate dev`:
--   psql "$DATABASE_URL" -f prisma/triggers.sql

-- Append-only tables: block UPDATE / DELETE
CREATE OR REPLACE FUNCTION block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quota_ledger_append_only ON "QuotaLedger";
CREATE TRIGGER quota_ledger_append_only
  BEFORE UPDATE OR DELETE ON "QuotaLedger"
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

DROP TRIGGER IF EXISTS audit_event_append_only ON "AuditEvent";
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- Sanity checks
ALTER TABLE "TicketLine" DROP CONSTRAINT IF EXISTS ticketline_qty_positive;
ALTER TABLE "TicketLine" ADD CONSTRAINT ticketline_qty_positive CHECK ("qtyBooked" > 0);

ALTER TABLE "Ticket" DROP CONSTRAINT IF EXISTS ticket_position_positive;
ALTER TABLE "Ticket" ADD CONSTRAINT ticket_position_positive CHECK ("position" > 0);
