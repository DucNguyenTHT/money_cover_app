-- What still keeps a period provisional, and whether anything happened in it at all.
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
SELECT
  (SELECT COUNT(*) FROM issue_items ii JOIN issues s ON s.id = ii.issue_id
    WHERE s.branch_id = $1 AND ii.pending_qty > 0 AND s.date BETWEEN $2::date AND $3::date)::int AS pending_lines,
  (SELECT COUNT(*) FROM orders o
    WHERE o.branch_id = $1 AND o.status = 'OPEN' AND o.business_date BETWEEN $2::date AND $3::date)::int AS open_orders,
  (SELECT COUNT(DISTINCT o.business_date) FROM orders o
    LEFT JOIN day_closings dc ON dc.branch_id = o.branch_id AND dc.business_date = o.business_date
    WHERE o.branch_id = $1 AND o.status = 'PAID' AND o.business_date BETWEEN $2::date AND $3::date
      AND (dc.id IS NULL OR dc.needs_reclose))::int AS unclosed_days,
  (SELECT COUNT(*) FROM stocktakes st
    WHERE st.branch_id = $1 AND st.status = 'DONE' AND st.date BETWEEN $2::date AND $3::date)::int AS stocktakes,
  (SELECT COUNT(*) FROM overhead_expenses e
    WHERE e.branch_id = $1 AND make_date(e.year, e.month, 1) BETWEEN date_trunc('month', $2::date)::date AND $3::date)::int AS overhead_rows,
  ((SELECT COUNT(*) FROM orders o WHERE o.branch_id = $1 AND o.business_date BETWEEN $2::date AND $3::date)
   + (SELECT COUNT(*) FROM receipts r WHERE r.branch_id = $1 AND r.date BETWEEN $2::date AND $3::date)
   + (SELECT COUNT(*) FROM issues s WHERE s.branch_id = $1 AND s.date BETWEEN $2::date AND $3::date))::int AS activity;
