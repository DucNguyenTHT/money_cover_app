-- One row per business day.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT
  o.business_date AS day,
  COUNT(*) FILTER (WHERE o.status = 'PAID')::int AS orders,
  COALESCE(SUM(o.guest_count) FILTER (WHERE o.status = 'PAID'), 0)::int AS guests,
  COALESCE(SUM(o.net_revenue) FILTER (WHERE o.status = 'PAID'), 0) AS net_revenue,
  COALESCE(SUM(o.cost_total) FILTER (WHERE o.status = 'PAID'), 0) AS cost_total,
  COALESCE(SUM(o.item_discount_total + o.order_discount_amount) FILTER (WHERE o.status = 'PAID'), 0) AS discounts,
  COALESCE(SUM(o.vat_amount) FILTER (WHERE o.status = 'PAID'), 0) AS vat,
  COALESCE(SUM(o.app_commission) FILTER (WHERE o.status = 'PAID'), 0) AS app_commission,
  COUNT(*) FILTER (WHERE o.status = 'CANCELLED' AND o.cancel_kind = 'CANCELLED')::int AS cancelled,
  COUNT(*) FILTER (WHERE o.status = 'PAID' AND o.net_revenue < o.cost_total)::int AS below_cost
FROM orders o
WHERE o.branch_id = $1 AND o.business_date BETWEEN $2::date AND $3::date
GROUP BY o.business_date
ORDER BY o.business_date;
