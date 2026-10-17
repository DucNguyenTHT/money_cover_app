-- Sales by area / table; takeaway and app orders are grouped under their channel.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT o.channel::text AS channel, COALESCE(a.name, '') AS area, COALESCE(t.name, '') AS table_name,
  COUNT(*)::int AS orders, COALESCE(SUM(o.net_revenue), 0) AS net_revenue
FROM orders o
LEFT JOIN tables t ON t.id = o.table_id
LEFT JOIN areas a ON a.id = t.area_id
WHERE o.branch_id = $1 AND o.status = 'PAID' AND o.business_date BETWEEN $2::date AND $3::date
GROUP BY o.channel, a.name, t.name
ORDER BY net_revenue DESC;
