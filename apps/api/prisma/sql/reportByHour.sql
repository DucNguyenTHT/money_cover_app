-- Sales by hour of payment (shop time).
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT EXTRACT(HOUR FROM o.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS hour,
  COUNT(*)::int AS orders, COALESCE(SUM(o.net_revenue), 0) AS net_revenue
FROM orders o
WHERE o.branch_id = $1 AND o.status = 'PAID' AND o.business_date BETWEEN $2::date AND $3::date
GROUP BY 1
ORDER BY 1;
