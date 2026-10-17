-- Cancelled orders (merges excluded), with who cancelled, who approved and whether it had been paid.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT o.id, o.code, o.business_date AS day, o.channel::text AS channel, o.total, o.cancel_reason, o.cancelled_at,
  (o.paid_at IS NOT NULL) AS was_paid, u.full_name AS cancelled_by,
  (SELECT ap.full_name FROM audit_logs al JOIN users ap ON ap.id = al.approved_by
    WHERE al.entity = 'order' AND al.entity_id = o.id::text AND al.action = 'CANCEL' LIMIT 1) AS approved_by
FROM orders o
LEFT JOIN users u ON u.id = o.cancelled_by
WHERE o.branch_id = $1 AND o.status = 'CANCELLED' AND o.cancel_kind = 'CANCELLED'
  AND o.business_date BETWEEN $2::date AND $3::date
ORDER BY o.cancelled_at DESC;
