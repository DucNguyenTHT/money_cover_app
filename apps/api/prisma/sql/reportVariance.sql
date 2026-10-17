-- Counted vs. book per ingredient for stocktakes completed in the period (lines with a difference).
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT st.id AS stocktake_id, st.date AS day, i.code, i.name, i.unit, si.book_qty, si.actual_qty, si.diff_qty, si.loss_value
FROM stocktake_items si
JOIN stocktakes st ON st.id = si.stocktake_id
JOIN ingredients i ON i.id = si.ingredient_id
WHERE st.branch_id = $1 AND st.status = 'DONE' AND st.date BETWEEN $2::date AND $3::date
  AND si.diff_qty IS NOT NULL AND si.diff_qty <> 0
ORDER BY st.date DESC, ABS(si.loss_value) DESC;
