/**
 * The name an employee card arrives with: its job ("Bookkeeper"), numbered
 * the way every name clash is when another AI Employee already goes by it
 * ("Bookkeeper 2"). Matches the field's value for `role`.
 */
export function prefilledName(role: string): RegExp {
  const literal = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${literal}( \\d+)?$`);
}
