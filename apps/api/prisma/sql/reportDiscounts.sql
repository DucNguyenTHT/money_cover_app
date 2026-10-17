-- Paid orders that got a discount, with the order profit after the discount (worst first).
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT o.id, o.code, o.business_date AS day, o.subtotal, (o.item_discount_total + o.order_discount_amount) AS discount,
  o.discount_reason, o.net_revenue, o.cost_total, u.full_name AS paid_by, ap.full_name AS approved_by
FROM orders o
LEFT JOIN users u ON u.id = o.paid_by
LEFT JOIN users ap ON ap.id = o.discount_approved_by
WHERE o.branch_id = $1 AND o.status = 'PAID' AND (o.item_discount_total + o.order_discount_amount) > 0
  AND o.business_date BETWEEN $2::date AND $3::date
ORDER BY (o.net_revenue - o.cost_total) ASC;
