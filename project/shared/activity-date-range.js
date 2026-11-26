/** Convert a timestamp to a local YYYY-MM-DD key for native date inputs. */
export function localDateKey(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Inclusive local-date range comparison. Invalid dates are excluded only when filtering. */
export function isWithinDateRange(value, fromDate = '', toDate = '') {
  if (!fromDate && !toDate) return true;
  const key = localDateKey(value);
  if (!key) return false;
  if (fromDate && key < fromDate) return false;
  if (toDate && key > toDate) return false;
  return true;
}
