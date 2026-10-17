-- Dishes cancelled after being sent to the kitchen.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT oi.id, o.code, o.business_date AS day, d.name AS dish, oi.qty, oi.amount, oi.cancel_reason, oi.wasted,
  oi.cancelled_at, u.full_name AS cancelled_by
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN dishes d ON d.id = oi.dish_id
LEFT JOIN users u ON u.id = oi.cancelled_by
WHERE o.branch_id = $1 AND oi.status = 'CANCELLED' AND o.business_date BETWEEN $2::date AND $3::date
ORDER BY oi.cancelled_at DESC;
