-- Book value of the stock at the end of a day: lots in − issues out − stocktake shortages.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:day
SELECT
  COALESCE((SELECT SUM(l.qty_in * l.unit_price) FROM lots l WHERE l.branch_id = $1 AND l.date <= $2::date), 0)
  - COALESCE((SELECT SUM(ii.cost_total) FROM issue_items ii JOIN issues s ON s.id = ii.issue_id
              WHERE s.branch_id = $1 AND s.date <= $2::date), 0)
  - COALESCE((SELECT SUM(sa.qty * sa.unit_price) FROM stocktake_allocations sa
              JOIN stocktake_items si ON si.id = sa.stocktake_item_id
              JOIN stocktakes st ON st.id = si.stocktake_id
              WHERE st.branch_id = $1 AND st.status = 'DONE' AND st.date <= $2::date), 0) AS value;
