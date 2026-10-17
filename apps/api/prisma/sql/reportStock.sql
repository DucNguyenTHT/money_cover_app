-- Stocktake result, purchases and stocktake surpluses of a period.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT
  COALESCE((SELECT SUM(si.loss_value) FROM stocktake_items si JOIN stocktakes st ON st.id = si.stocktake_id
            WHERE st.branch_id = $1 AND st.status = 'DONE' AND st.date BETWEEN $2::date AND $3::date), 0) AS stocktake_loss,
  (SELECT COUNT(*) FROM stocktakes st WHERE st.branch_id = $1 AND st.status = 'DONE' AND st.date BETWEEN $2::date AND $3::date)::int AS stocktakes,
  COALESCE((SELECT SUM(ri.amount) FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
            WHERE r.branch_id = $1 AND r.kind = 'PURCHASE' AND r.date BETWEEN $2::date AND $3::date), 0) AS purchases,
  COALESCE((SELECT SUM(l.qty_in * l.unit_price) FROM lots l
            WHERE l.branch_id = $1 AND l.stocktake_item_id IS NOT NULL AND l.date BETWEEN $2::date AND $3::date), 0) AS surplus_in;
