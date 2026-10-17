-- Item net amounts (after discounts, without VAT / service charge) of PAID orders per tax group of the dish
-- category. The P&L spreads net revenue (incl. service charge) over the groups in these proportions.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT c.tax_group::text AS tax_group, COALESCE(SUM(oi.net_amount), 0) AS net_amount
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN dishes d ON d.id = oi.dish_id
JOIN dish_categories c ON c.id = d.category_id
WHERE o.branch_id = $1 AND o.status = 'PAID' AND oi.status = 'ACTIVE'
  AND o.business_date BETWEEN $2::date AND $3::date
GROUP BY c.tax_group
ORDER BY c.tax_group;
