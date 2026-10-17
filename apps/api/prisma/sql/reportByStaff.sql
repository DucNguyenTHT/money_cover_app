-- Sales by the cashier who took the payment.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT u.id AS user_id, u.full_name, COUNT(*)::int AS orders, COALESCE(SUM(o.net_revenue), 0) AS net_revenue,
  COALESCE(SUM(o.item_discount_total + o.order_discount_amount), 0) AS discounts
FROM orders o
JOIN users u ON u.id = o.paid_by
WHERE o.branch_id = $1 AND o.status = 'PAID' AND o.business_date BETWEEN $2::date AND $3::date
GROUP BY u.id, u.full_name
ORDER BY net_revenue DESC;
