-- Stock issued per reason (SALE_USE = cost of goods sold). from_order = disposal of a cancelled cooked dish.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT s.reason::text AS reason, (s.order_item_id IS NOT NULL) AS from_order, COALESCE(SUM(ii.cost_total), 0) AS cost
FROM issues s
JOIN issue_items ii ON ii.issue_id = s.id
WHERE s.branch_id = $1 AND s.date BETWEEN $2::date AND $3::date
GROUP BY s.reason, (s.order_item_id IS NOT NULL);
