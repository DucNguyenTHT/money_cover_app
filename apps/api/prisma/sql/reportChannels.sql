-- Net revenue and order count per sales channel.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT channel::text AS channel, COUNT(*)::int AS orders, COALESCE(SUM(net_revenue), 0) AS net_revenue
FROM orders
WHERE branch_id = $1 AND status = 'PAID' AND business_date BETWEEN $2::date AND $3::date
GROUP BY channel
ORDER BY channel;
