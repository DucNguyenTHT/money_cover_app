-- Nhập – xuất – tồn per ingredient: opening, movements in the period, closing (quantity and value).
-- @param {Int} $1:branchId
-- @param {DateTime} $2:from
-- @param {DateTime} $3:to
WITH lots_p AS (
  SELECT ingredient_id,
    SUM(qty_in) FILTER (WHERE date < $2::date) AS in_before_q,
    SUM(qty_in * unit_price) FILTER (WHERE date < $2::date) AS in_before_v,
    SUM(qty_in) FILTER (WHERE date BETWEEN $2::date AND $3::date AND receipt_item_id IS NOT NULL) AS in_q,
    SUM(qty_in * unit_price) FILTER (WHERE date BETWEEN $2::date AND $3::date AND receipt_item_id IS NOT NULL) AS in_v,
    SUM(qty_in) FILTER (WHERE date BETWEEN $2::date AND $3::date AND stocktake_item_id IS NOT NULL) AS surplus_q,
    SUM(qty_in * unit_price) FILTER (WHERE date BETWEEN $2::date AND $3::date AND stocktake_item_id IS NOT NULL) AS surplus_v
  FROM lots WHERE branch_id = $1 GROUP BY ingredient_id
), out_p AS (
  SELECT ii.ingredient_id,
    SUM(ii.qty) FILTER (WHERE s.date < $2::date) AS out_before_q,
    SUM(ii.cost_total) FILTER (WHERE s.date < $2::date) AS out_before_v,
    SUM(ii.qty) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'SALE_USE') AS sale_q,
    SUM(ii.cost_total) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'SALE_USE') AS sale_v,
    SUM(ii.qty) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'DISPOSAL') AS disposal_q,
    SUM(ii.cost_total) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'DISPOSAL') AS disposal_v,
    SUM(ii.qty) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'SUPPLIER_RETURN') AS return_q,
    SUM(ii.cost_total) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'SUPPLIER_RETURN') AS return_v,
    SUM(ii.qty) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'INTERNAL_USE') AS internal_q,
    SUM(ii.cost_total) FILTER (WHERE s.date BETWEEN $2::date AND $3::date AND s.reason = 'INTERNAL_USE') AS internal_v
  FROM issue_items ii JOIN issues s ON s.id = ii.issue_id
  WHERE s.branch_id = $1 GROUP BY ii.ingredient_id
), short_p AS (
  SELECT si.ingredient_id,
    SUM(sa.qty) FILTER (WHERE st.date < $2::date) AS short_before_q,
    SUM(sa.qty * sa.unit_price) FILTER (WHERE st.date < $2::date) AS short_before_v,
    SUM(sa.qty) FILTER (WHERE st.date BETWEEN $2::date AND $3::date) AS short_q,
    SUM(sa.qty * sa.unit_price) FILTER (WHERE st.date BETWEEN $2::date AND $3::date) AS short_v
  FROM stocktake_allocations sa
  JOIN stocktake_items si ON si.id = sa.stocktake_item_id
  JOIN stocktakes st ON st.id = si.stocktake_id
  WHERE st.branch_id = $1 AND st.status = 'DONE' GROUP BY si.ingredient_id
)
SELECT i.id AS ingredient_id, i.code, i.name, i.unit,
  COALESCE(l.in_before_q, 0) - COALESCE(o.out_before_q, 0) - COALESCE(sp.short_before_q, 0) AS open_q,
  COALESCE(l.in_before_v, 0) - COALESCE(o.out_before_v, 0) - COALESCE(sp.short_before_v, 0) AS open_v,
  COALESCE(l.in_q, 0) AS in_q, COALESCE(l.in_v, 0) AS in_v,
  COALESCE(l.surplus_q, 0) AS surplus_q, COALESCE(l.surplus_v, 0) AS surplus_v,
  COALESCE(o.sale_q, 0) AS sale_q, COALESCE(o.sale_v, 0) AS sale_v,
  COALESCE(o.disposal_q, 0) AS disposal_q, COALESCE(o.disposal_v, 0) AS disposal_v,
  COALESCE(o.return_q, 0) AS return_q, COALESCE(o.return_v, 0) AS return_v,
  COALESCE(o.internal_q, 0) AS internal_q, COALESCE(o.internal_v, 0) AS internal_v,
  COALESCE(sp.short_q, 0) AS short_q, COALESCE(sp.short_v, 0) AS short_v
FROM ingredients i
LEFT JOIN lots_p l ON l.ingredient_id = i.id
LEFT JOIN out_p o ON o.ingredient_id = i.id
LEFT JOIN short_p sp ON sp.ingredient_id = i.id
ORDER BY i.code;
