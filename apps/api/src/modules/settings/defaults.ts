import type { Settings } from '../../contracts/settings.contract';

/** Defaults used by the seed and as a fallback for keys missing from the settings table. */
export const DEFAULT_SETTINGS: Settings = {
  food_cost_target_default: 35,
  overhead_rate_mode: 'AUTO',
  overhead_rate_manual: 10,
  price_rounding: 1000,
  alert_tolerance_pct: 2,
  max_discount_pct: 10,
  business_day_start: '04:00',
  bill_footer: 'Cảm ơn quý khách, hẹn gặp lại!',
  vat_pct: 0,
  vat_mode: 'EXCLUSIVE',
  service_charge_pct: 0,
  service_charge_channels: ['DINE_IN'],
  bank_bin: '',
  bank_account_no: '',
  bank_account_name: '',
  print_mode: 'SERVER',
  tax_regime: 'HOUSEHOLD',
  household_pit_method: 'INCOME',
  einvoice_registered: false,
  backup_hour: 2,
  reorder_days: 3,
  backup_drive: true,
  backup_telegram: true,
  backup_telegram_documents: true,
};
