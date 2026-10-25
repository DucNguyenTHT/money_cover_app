-- Monthly P&L, sales part: PAID orders by business date.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT
  COUNT(*)::int AS orders,
  COALESCE(SUM(guest_count), 0)::int AS guests,
  COALESCE(SUM(subtotal), 0) AS revenue_gross,
  COALESCE(SUM(item_discount_total + order_discount_amount + points_discount), 0) AS discounts,
  COALESCE(SUM(service_charge_amount), 0) AS service_charge,
  COALESCE(SUM(CASE WHEN vat_mode = 'INCLUSIVE' THEN vat_amount ELSE 0 END), 0) AS vat_in_price,
  COALESCE(SUM(net_revenue), 0) AS net_revenue,
  COALESCE(SUM(vat_amount), 0) AS vat_collected,
  COALESCE(SUM(app_commission), 0) AS app_commission,
  COALESCE(SUM(cost_total), 0) AS cost_total
FROM orders
WHERE branch_id = $1 AND status = 'PAID' AND business_date BETWEEN $2::date AND $3::date;
