export const DelegationCommand = {
  Get: "delegation/get",
  Set: "delegation/set",
} as const;

export type DelegationCommandType =
  (typeof DelegationCommand)[keyof typeof DelegationCommand];
