-- Money received per payment method (cash already net of change).
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT p.method::text AS method, COUNT(*)::int AS payments, COALESCE(SUM(p.amount), 0) AS amount
FROM order_payments p
JOIN orders o ON o.id = p.order_id
WHERE o.branch_id = $1 AND o.status = 'PAID' AND o.business_date BETWEEN $2::date AND $3::date
GROUP BY p.method
ORDER BY p.method;
