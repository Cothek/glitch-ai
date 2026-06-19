/**
 * CSV Processor Tool
 * Parses CSV data, validates email fields, converts numeric fields, and sorts by specified field.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks if a string value represents a valid number.
 * @param {string} value - The string value to check
 * @returns {boolean} - True if the value is a valid number
 */
function isValidNumber(value) {
  const num = Number(value);
  return !isNaN(num) && value !== '' && value.trim() !== '';
}

/**
 * Converts a string value to a number if it's a valid number, otherwise returns the original string.
 * @param {string} value - The string value to convert
 * @returns {number|string} - The converted number or original string
 */
function convertNumeric(value) {
  if (isValidNumber(value)) {
    return Number(value);
  }
  return value;
}

/**
 * Validates an email address using a simple regex.
 * @param {string} email - The email address to validate
 * @returns {boolean} - True if the email is valid
 */
function validateEmail(email) {
  return EMAIL_REGEX.test(email);
}

/**
 * Parses a CSV string into an array of objects.
 * @param {string} csv - The CSV string to parse
 * @returns {Array<Object>} - Array of parsed row objects
 */
function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = line.split(',').map(v => v.trim());
    const row = {};

    headers.forEach((header, index) => {
      const value = values[index] ?? '';
      row[header] = convertNumeric(value);
    });

    rows.push(row);
  }

  return rows;
}

/**
 * Main handler function for the CSV processor tool.
 * @param {Object} input - Input object containing csv and sortField
 * @param {string} input.csv - CSV string with header row
 * @param {string} input.sortField - Field name to sort by
 * @returns {Array<Object>} - Processed and sorted rows
 */
export function handler(input) {
  const { csv, sortField } = input;

  if (!csv || typeof csv !== 'string') {
    throw new Error('Invalid input: csv must be a non-empty string');
  }

  if (!sortField || typeof sortField !== 'string') {
    throw new Error('Invalid input: sortField must be a non-empty string');
  }

  // Parse CSV
  const rows = parseCSV(csv);

  // Add emailValid field to each row
  rows.forEach(row => {
    const email = row.email ?? '';
    row.emailValid = validateEmail(String(email));
  });

  // Sort by sortField using localeCompare for strings
  rows.sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];

    // Handle missing fields
    if (aVal === undefined && bVal === undefined) return 0;
    if (aVal === undefined) return 1;
    if (bVal === undefined) return -1;

    // Use localeCompare for string comparison
    return String(aVal).localeCompare(String(bVal));
  });

  return rows;
}