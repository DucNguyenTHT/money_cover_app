-- Stocktake loss allocated to each dish (dish_id NULL = general loss) for stocktakes completed in the period.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT a.dish_id, COALESCE(SUM(a.value), 0) AS value
FROM stocktake_dish_allocations a
JOIN stocktake_items si ON si.id = a.stocktake_item_id
JOIN stocktakes st ON st.id = si.stocktake_id
WHERE st.branch_id = $1 AND st.status = 'DONE' AND st.date BETWEEN $2::date AND $3::date
GROUP BY a.dish_id;
