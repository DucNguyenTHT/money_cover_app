-- Profit per dish from PAID orders. App commission is shared by each line's part of its order.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
-- @param {String} $4:channel?
SELECT d.id AS dish_id, d.name, c.name AS category,
  SUM(oi.qty)::int AS qty,
  COALESCE(SUM(oi.amount), 0) AS gross,
  COALESCE(SUM(oi.net_amount), 0) AS net_revenue,
  COALESCE(SUM(oi.cost_total), 0) AS cost,
  COALESCE(SUM(CASE WHEN o.net_revenue > 0 THEN o.app_commission * oi.net_amount / o.net_revenue ELSE 0 END), 0) AS app_commission
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN dishes d ON d.id = oi.dish_id
JOIN dish_categories c ON c.id = d.category_id
WHERE o.branch_id = $1 AND o.status = 'PAID' AND oi.status = 'ACTIVE'
  AND o.business_date BETWEEN $2::date AND $3::date
  AND ($4::text IS NULL OR o.channel::text = $4::text)
GROUP BY d.id, d.name, c.name
ORDER BY net_revenue DESC;
